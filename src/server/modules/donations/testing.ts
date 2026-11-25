// Shared set-up for the donations module's Seam 1 tests: donations started
// and paid through the real use cases, the fake gateway and its webhook
// simulator. Test code only; nothing in the app imports it.

import { eq } from "drizzle-orm";
import { expect } from "vitest";

import type { Actor } from "@/server/actor";
import { donation, paymentBatch } from "@/server/db/schema";
import {
  verifiedGuardian,
  bornYearsAgo,
} from "@/server/modules/guardians/testing";
import type { Harness } from "@/test/harness";

import type { StartDonationInput } from "./start-donation";

/** Rs 500, from a person, off the wall, both declarations made. */
export function donationForm(
  overrides: Partial<StartDonationInput> = {}
): StartDonationInput {
  return {
    amountMinor: 50_000n,
    donorType: "individual",
    name: "Asha Rao",
    email: "asha@example.test",
    showOnWall: false,
    declaredAdult: true,
    declaredIndianSource: true,
    ...overrides,
  };
}

/** Donations open, as on a local run or a preview. */
export async function openDonations(h: Harness): Promise<void> {
  await h.settings.set("donations.enabled", true);
}

export type Started = { donationId: string; checkoutToken: string };

/** A pending donation started by `actor` (a visitor by default). */
export async function startedDonation(
  h: Harness,
  overrides: Partial<StartDonationInput> = {},
  actor: Actor = h.visitor()
): Promise<Started> {
  const started = await h.as(actor).startDonation(donationForm(overrides));
  if (!started.ok) throw new Error(`Start failed: ${started.error}`);
  return {
    donationId: started.donationId,
    checkoutToken: started.checkoutToken,
  };
}

/** The donation's gateway order, opened through payForDonation. */
export async function openedOrder(
  h: Harness,
  started: Started,
  actor: Actor = h.visitor()
): Promise<string> {
  const paying = await h.as(actor).payForDonation(started);
  if (!paying.ok || paying.kind !== "checkout") {
    throw new Error(`No checkout: ${JSON.stringify(paying)}`);
  }
  return paying.checkout.orderId;
}

/** The payer pays the order; the gateway's webhook says so. */
export async function paidByWebhook(
  h: Harness,
  orderId: string,
  payment: Parameters<Harness["gateway"]["capture"]>[1] = {}
) {
  const captured = h.gateway.capture(orderId, payment);
  const result = await h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );
  expect(result.ok).toBe(true);
  return captured;
}

/** A donation started, paid in full by webhook, and its events drained. */
export async function capturedDonation(
  h: Harness,
  overrides: Partial<StartDonationInput> = {},
  actor: Actor = h.visitor()
) {
  const started = await startedDonation(h, overrides, actor);
  const orderId = await openedOrder(h, started, actor);
  const payment = await paidByWebhook(h, orderId);
  await h.drain();
  return { ...started, orderId, paymentId: payment.paymentId };
}

export async function donationRow(h: Harness, donationId: string) {
  const [row] = await h.db
    .select()
    .from(donation)
    .where(eq(donation.id, donationId));
  if (!row) throw new Error(`No donation ${donationId}`);
  return row;
}

export async function batchOf(h: Harness, donationId: string) {
  const row = await donationRow(h, donationId);
  const [batch] = await h.db
    .select()
    .from(paymentBatch)
    .where(eq(paymentBatch.id, row.paymentBatchId!));
  if (!batch) throw new Error(`No batch for ${donationId}`);
  return batch;
}

/** The newest receipt link emailed to `to`, as its token. */
export function receiptTokenSentTo(h: Harness, to: string): string {
  const text = h.email.lastTo(to)?.text ?? "";
  const token = /\/receipts\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(
    text
  )?.[1];
  if (!token) throw new Error(`No receipt link was emailed to ${to}`);
  return token;
}

/**
 * A guardian with a 17-year-old who signs in with their own login (#81),
 * through the real use cases. They turn 18 two days after the clock.
 */
export async function teenWithLogin(h: Harness) {
  const guardian = await verifiedGuardian(h, {
    name: "Sunita Rao",
    email: "sunita@example.test",
  });
  const child = await h.as(guardian.actor).addChild({
    fullName: "Arjun Rao",
    dateOfBirth: bornYearsAgo(h, 18, -2),
    relationship: "parent",
  });
  if (!child.ok) throw new Error("Could not add the child");
  const invited = await h
    .as(guardian.actor)
    .inviteTeenLogin({ childId: child.childId, email: "arjun@example.test" });
  if (!invited.ok) throw new Error(`Invite failed: ${invited.error}`);
  await h.drain();
  const token =
    /\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(
      h.email.lastTo("arjun@example.test")?.text ?? ""
    )?.[1] ?? "";
  const teen = await h.signIn(
    await h.seed.member({ name: "Arjun Rao", email: "arjun@example.test" })
  );
  const accepted = await h.as(teen).acceptTeenInvitation({ token });
  if (!accepted.ok) throw new Error(`Accept failed: ${accepted.error}`);
  return { guardian: guardian.actor, teen };
}
