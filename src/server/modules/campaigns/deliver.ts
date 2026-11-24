// The outbox handler campaigns.deliver_message (#126): one recipient's
// message of a sent campaign. Just before it goes, it checks again that a
// consent the message rests on still holds (a withdrawal since the send,
// or a guardian who no longer looks after the child, stops it), then sends
// it in-app and by email through the notifications module: email only
// where the recipient's channel choice allows it and they have an address;
// never by SMS. Each message carries the recipient's withdrawal link.
//
// The recipient row settles as `sent` or `skipped` once its message is
// done; a port failure leaves it `queued` and is thrown, so the outbox
// retries the event (the delivery rows keep each channel to one send). The
// last row to settle marks the campaign `sent` and audits the counts,
// under the campaign's row lock, so exactly one run does it.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";

import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { campaign, campaignRecipient, messageRoute } from "../../db/schema";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import {
  deliverToAccount,
  preferencesOf,
  recipientOf,
} from "../notifications/dispatch";
import { planDelivery } from "../notifications/domain/delivery-plan";
import { basisHolds, type BasisCheck, type ConsentBasis } from "./domain/audience";
import { activeGuardians, latestConsents } from "./load-audience";
import {
  CAMPAIGN_TEMPLATE,
  campaignTemplates,
  campaignValues,
  withNotice,
} from "./render";
import { deliveryCounts } from "./use-cases/send";
import { withdrawalUrl } from "./withdrawal-link";

const WORKER = { kind: "system", process: "worker" } as const;

/** What each basis is now, for `basisHolds`. */
export async function checksFor(
  db: AppDb,
  recipientUserId: string,
  bases: readonly ConsentBasis[]
): Promise<BasisCheck[]> {
  const users = bases.filter((b) => b.purpose === "messages");
  const children = bases.filter((b) => b.purpose === "communications");
  const [own, ofChildren, guardians] = await Promise.all([
    latestConsents(db, "user", "messages", users.map((b) => b.subjectId)),
    latestConsents(
      db,
      "participant_profile",
      "communications",
      children.map((b) => b.subjectId)
    ),
    activeGuardians(
      db,
      children.map((b) => b.subjectId)
    ),
  ]);
  return bases.map((basis) =>
    basis.purpose === "messages"
      ? {
          purpose: "messages",
          current: own.get(basis.subjectId) ?? { status: "never" },
        }
      : {
          purpose: "communications",
          current: ofChildren.get(basis.subjectId) ?? { status: "never" },
          recipientIsActiveGuardian: (
            guardians.get(basis.subjectId) ?? []
          ).includes(recipientUserId),
        }
  );
}

export async function deliverCampaignMessage(
  deps: OutboxDeps,
  delivery: Delivery<"campaign.message_due">
): Promise<void> {
  const { campaignId, recipientId } = delivery.payload;
  const [row] = await deps.db
    .select({
      recipient: campaignRecipient,
      status: campaign.status,
      subject: campaign.subject,
      body: campaign.body,
    })
    .from(campaignRecipient)
    .innerJoin(campaign, eq(campaign.id, campaignRecipient.campaignId))
    .where(
      and(
        eq(campaignRecipient.id, recipientId),
        eq(campaignRecipient.campaignId, campaignId)
      )
    );
  // Settled already, or the account is gone (its row went with it).
  if (!row || row.recipient.status !== "queued" || row.status !== "sending") {
    await completeIfSettled(deps, campaignId);
    return;
  }
  const { recipient } = row;

  const checks = await checksFor(deps.db, recipient.userId, recipient.bases);
  const account = await recipientOf(deps, recipient.userId);
  if (!account || !checks.some((check) => basisHolds(check, recipient.userId))) {
    await settle(deps, recipient.id, campaignId, "skipped");
    return;
  }

  const [route] = await deps.db
    .select()
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, "campaign.message_due"),
        eq(messageRoute.templateKey, CAMPAIGN_TEMPLATE),
        eq(messageRoute.enabled, true)
      )
    )
    .orderBy(asc(messageRoute.audience))
    .limit(1);
  // Switched off by a migration: the event fails and stays for staff.
  if (!route) throw new Error("No enabled route sends campaign messages");
  const templates = await campaignTemplates(deps.db);
  if (!templates.email || !templates.in_app) {
    throw new Error(`Template ${CAMPAIGN_TEMPLATE} lacks email or in-app`);
  }
  if (!deps.auth.baseUrl) {
    // Thrown, so the outbox retries once the worker has APP_URL.
    throw new Error(
      `Campaign message ${recipientId} needs the site's base URL (APP_URL) for its link`
    );
  }

  const channels = route.channels.filter((channel) => channel !== "sms");
  const plan = planDelivery({
    routeChannels: channels,
    requiredByLaw: false,
    preferences: await preferencesOf(deps.db, recipient.userId),
    // Checked above, on the consent this message rests on.
    messagesConsent: true,
    smsEnabled: false,
    smsTemplateRegistered: false,
    contact: { email: account.email !== null, verifiedPhone: false },
  });
  const failures = await deliverToAccount(
    deps,
    {
      delivery,
      route: { ...route, channels },
      templates: withNotice(templates),
      recipient: account,
      values: campaignValues(row, {
        name: account.name,
        withdrawalUrl: withdrawalUrl(
          deps.auth.baseUrl,
          deps.blindIndex,
          recipient.id
        ),
      }),
    },
    plan
  );
  // The port's own error, as the outbox keeps it for staff.
  if (failures.length > 0) throw failures[0]!.error;
  await settle(deps, recipient.id, campaignId, "sent");
}

async function settle(
  deps: OutboxDeps,
  recipientId: string,
  campaignId: string,
  status: "sent" | "skipped"
): Promise<void> {
  await deps.db
    .update(campaignRecipient)
    .set({ status, settledAt: deps.clock.now() })
    .where(
      and(
        eq(campaignRecipient.id, recipientId),
        eq(campaignRecipient.status, "queued")
      )
    );
  await completeIfSettled(deps, campaignId);
}

/**
 * Marks a sending campaign `sent` once no message waits, with its audit
 * entry: how many went and how many were held back. Under the campaign's
 * lock, so of two runs settling the last rows only one does it.
 */
async function completeIfSettled(
  deps: OutboxDeps,
  campaignId: string
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: campaign.status })
      .from(campaign)
      .where(eq(campaign.id, campaignId))
      .for("update");
    if (locked?.status !== "sending") return;
    const counts = await deliveryCounts(tx, campaignId);
    if (counts.queued > 0) return;
    const now = deps.clock.now();
    await tx
      .update(campaign)
      .set({ status: "sent", completedAt: now, updatedAt: now })
      .where(eq(campaign.id, campaignId));
    await recordAudit(
      tx,
      { clock: deps.clock, actor: WORKER },
      {
        action: "campaign.completed",
        entity: { type: "campaign", id: campaignId },
        before: { status: "sending" },
        after: { status: "sent", delivered: counts },
        actorRole: null,
      }
    );
  });
}
