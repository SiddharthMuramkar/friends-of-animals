// The donor's messages (#106), as outbox handlers. A guest donor has no
// account, so no route row can name them: each handler reads its event's
// route row (audience `donor`) and, while it is enabled, renders the row's
// template (staff edit the wording, HR-50) and emails the address the
// donor gave through the shared contact delivery, which sends each message
// once per event (../notifications/contact-delivery.ts). A signed-in donor
// also gets the in-app wording, which carries no link.
//
//   donations.send_thank_you     donation.captured: thanks, the receipt
//                                number and the first receipt link
//   donations.send_receipt_link  receipt.link_requested: a new link
//   donations.send_refund_notice donation.refunded: the money went back
//
// A receipt link's token is minted here, as the email goes, never in the
// capture transaction: the plain token never sits in the outbox. A retry
// after the email went mints a link nobody receives, which expires unused.
//
// Thrown messages name ids only. Loads under plain Node (the worker).

import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  donation,
  donor,
  messageRoute,
  messageTemplate,
  receipt,
  recurringDonation,
  receiptLink,
  refund,
  type MessageRouteRow,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { receiptPath } from "../../../lib/app-routes";
import { LOCALE, TIME_ZONE } from "../../../i18n/formats";
import {
  sendToContact,
  type ContactMessage,
} from "../notifications/contact-delivery";
import { deliverInApp } from "../notifications/dispatch";
import { DEFAULT_LOCALE } from "../notifications/locale";
import { formatPaise } from "../payments/domain/money-format";
import {
  mintReceiptLinkToken,
  receiptLinkExpiresAt,
} from "./domain/receipt-link";
import { donorContact } from "./donors";

/** The audience of the route rows that reach a donor. */
export const DONOR_AUDIENCE = "donor";

const expiryDate = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "long",
  timeZone: TIME_ZONE,
});

type DonorEvent =
  | "donation.captured"
  | "receipt.link_requested"
  | "donation.refunded"
  | RecurringNotice;

type RecurringNotice =
  | "recurring_donation.activated"
  | "recurring_donation.charge_failed"
  | "recurring_donation.cancelled"
  | "recurring_donation.refunded";

/** The event's enabled route to the donor with `templateKey`, if any. */
async function routeTo(
  db: AppDb,
  eventType: DonorEvent,
  templateKey: string
): Promise<MessageRouteRow | null> {
  const [route] = await db
    .select()
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, eventType),
        eq(messageRoute.audience, DONOR_AUDIENCE),
        eq(messageRoute.templateKey, templateKey),
        eq(messageRoute.enabled, true)
      )
    )
    .orderBy(asc(messageRoute.createdAt))
    .limit(1);
  return route ?? null;
}

async function templatesOf(
  db: AppDb,
  key: string
): Promise<ContactMessage["templates"]> {
  const rows = await db
    .select()
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, key),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  return Object.fromEntries(rows.map((row) => [row.channel, row]));
}

/** The donation's donor, decrypted, with its receipt if it has one. */
async function donorOf(deps: OutboxDeps, donationId: string) {
  const [row] = await deps.db
    .select({
      donationId: donation.id,
      amountMinor: donation.amountMinor,
      userId: donor.userId,
      name: donor.name,
      email: donor.email,
      receiptId: receipt.id,
      receiptNumber: receipt.number,
    })
    .from(donation)
    .innerJoin(donor, eq(donor.id, donation.donorId))
    .leftJoin(receipt, eq(receipt.donationId, donation.id))
    .where(eq(donation.id, donationId));
  if (!row) return null;
  return { ...row, ...donorContact(deps.cipher, row) };
}

type Donor = NonNullable<Awaited<ReturnType<typeof donorOf>>>;

/**
 * A new 7-day link to the receipt, for the donor, and its URL. The token
 * goes in the URL only; the row keeps its hash.
 */
export async function mintDonorLink(
  deps: Pick<OutboxDeps, "db" | "clock" | "auth">,
  receiptId: string,
  createdByUserId: string | null = null
): Promise<{ url: string; expiresAt: Date }> {
  if (!deps.auth.baseUrl) {
    throw new Error(`Receipt ${receiptId}: no APP_URL for the link`);
  }
  const now = deps.clock.now();
  const { token, tokenHash } = mintReceiptLinkToken();
  const expiresAt = receiptLinkExpiresAt(now);
  await deps.db.insert(receiptLink).values({
    id: uuidv7(now),
    receiptId,
    tokenHash,
    issuedTo: "donor",
    createdByUserId,
    createdAt: now,
    expiresAt,
  });
  return {
    url: new URL(receiptPath(token), deps.auth.baseUrl).href,
    expiresAt,
  };
}

/** Sends `templateKey`'s wordings to the donor: email, and in-app. */
async function sendToDonor(
  deps: OutboxDeps,
  delivery: Delivery<DonorEvent>,
  route: MessageRouteRow,
  giver: Pick<Donor, "name" | "email" | "userId">,
  values: Record<string, string>
): Promise<void> {
  const templates = await templatesOf(deps.db, route.templateKey);
  const failure = await sendToContact(
    deps,
    {
      delivery,
      route,
      templates,
      contactKey: giver.email,
      email: giver.email,
      phone: null,
      values: { "recipient.name": giver.name, ...values },
    },
    false
  );
  if (giver.userId && route.channels.includes("in_app")) {
    await deliverInApp(deps, {
      delivery,
      route,
      templates,
      recipient: { id: giver.userId },
      values: { "recipient.name": giver.name, ...values },
    });
  }
  if (failure !== null) throw failure;
}

/** The receipt number, amount and a fresh link, as both messages print them. */
async function receiptValues(
  deps: OutboxDeps,
  giver: Donor,
  withLink: boolean
): Promise<Record<string, string>> {
  if (!giver.receiptId || !giver.receiptNumber) {
    throw new Error(`Donation ${giver.donationId} has no receipt`);
  }
  const values: Record<string, string> = {
    "donation.amount": formatPaise(giver.amountMinor),
    "receipt.number": giver.receiptNumber,
  };
  if (!withLink) return values;
  const link = await mintDonorLink(deps, giver.receiptId);
  return {
    ...values,
    "receipt.link": link.url,
    "receipt.expiresOn": expiryDate.format(link.expiresAt),
  };
}

export async function sendThankYou(
  deps: OutboxDeps,
  delivery: Delivery<"donation.captured">
): Promise<void> {
  const route = await routeTo(
    deps.db,
    delivery.eventType,
    "donation.thank_you"
  );
  if (!route) return;
  const giver = await donorOf(deps, delivery.payload.donationId);
  if (!giver) return;
  const values = await receiptValues(
    deps,
    giver,
    route.channels.includes("email")
  );
  await sendToDonor(deps, delivery, route, giver, values);
}

export async function sendReceiptLink(
  deps: OutboxDeps,
  delivery: Delivery<"receipt.link_requested">
): Promise<void> {
  const route = await routeTo(
    deps.db,
    delivery.eventType,
    "donation.receipt_link"
  );
  if (!route) return;
  const [issued] = await deps.db
    .select({
      donationId: receipt.donationId,
      cancelledAt: receipt.cancelledAt,
    })
    .from(receipt)
    .where(eq(receipt.id, delivery.payload.receiptId));
  // Cancelled since it was asked for: no new link to it.
  if (!issued || issued.cancelledAt) return;
  const giver = await donorOf(deps, issued.donationId);
  if (!giver) return;
  const values = await receiptValues(
    deps,
    giver,
    route.channels.includes("email")
  );
  await sendToDonor(deps, delivery, route, giver, values);
}

export async function sendRefundNotice(
  deps: OutboxDeps,
  delivery: Delivery<"donation.refunded">
): Promise<void> {
  const [returned] = await deps.db
    .select({
      kind: refund.kind,
      amountMinor: refund.amountMinor,
      gatewayRefundId: refund.gatewayRefundId,
      manualReference: refund.manualReference,
    })
    .from(refund)
    .where(eq(refund.id, delivery.payload.refundId));
  if (!returned) return;
  const route = await routeTo(
    deps.db,
    delivery.eventType,
    returned.kind === "foreign_payment"
      ? "donation.foreign_refunded"
      : "donation.refunded"
  );
  if (!route) return;
  const giver = await donorOf(deps, delivery.payload.donationId);
  if (!giver) return;
  await sendToDonor(deps, delivery, route, giver, {
    "donation.amount": formatPaise(giver.amountMinor),
    "refund.amount": formatPaise(returned.amountMinor),
    "refund.reference":
      returned.gatewayRefundId ?? returned.manualReference ?? "",
  });
}

export async function sendRecurringNotice(
  deps: OutboxDeps,
  delivery: Delivery<RecurringNotice>
): Promise<void> {
  const route = await routeTo(deps.db, delivery.eventType, delivery.eventType);
  if (!route) return;
  const [row] = await deps.db
    .select({ name: donor.name, email: donor.email, userId: donor.userId })
    .from(recurringDonation)
    .innerJoin(donor, eq(donor.id, recurringDonation.donorId))
    .where(eq(recurringDonation.id, delivery.payload.id));
  if (!row) return;
  await sendToDonor(
    deps,
    delivery,
    route,
    { ...row, ...donorContact(deps.cipher, row) },
    {}
  );
}
