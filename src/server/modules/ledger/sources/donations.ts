// What the ledger reads about donations (#106): a captured donation's
// money, and foreign money refused for one while FCRA is off. Each becomes
// one posting, keyed by its source, so a replayed event, the nightly
// reconcile and a refund that needs its original all find the same one.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, isNotNull } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import { donation, donor, refund } from "../../../db/schema";
import type { DonationIncome, MoneyMethod } from "../domain/posting-rules";

export type DonationFact = {
  source: { type: "donation"; id: string };
  occurredAt: Date;
  amountMinor: bigint;
  method: MoneyMethod;
  donorType: DonationIncome;
  /** The gateway payment it was captured with. */
  gatewayPaymentId: string | null;
};

export type ForeignDonationFact = {
  source: { type: "foreign_donation"; id: string };
  occurredAt: Date;
  amountMinor: bigint;
};

/** A donation that took its money, or undefined. */
export async function readDonation(
  db: AppDb,
  donationId: string
): Promise<DonationFact | undefined> {
  const [row] = await db
    .select({
      amountMinor: donation.amountMinor,
      currency: donation.currency,
      capturedAt: donation.capturedAt,
      gatewayPaymentId: donation.gatewayPaymentId,
      offlineMethod: donation.offlineMethod,
      donorType: donor.type,
    })
    .from(donation)
    .innerJoin(donor, eq(donor.id, donation.donorId))
    .where(and(eq(donation.id, donationId), isNotNull(donation.capturedAt)));
  if (!row?.capturedAt || (!row.gatewayPaymentId && !row.offlineMethod))
    return undefined;
  if (row.currency !== "INR") throw new Error("A donation posts in INR");
  return {
    source: { type: "donation", id: donationId },
    occurredAt: row.capturedAt,
    amountMinor: row.amountMinor,
    method: row.offlineMethod ?? "gateway",
    donorType: row.donorType,
    gatewayPaymentId: row.gatewayPaymentId,
  };
}

/** The donation a payment batch pays for, if it pays for one. */
export async function donationOfBatch(
  db: AppDb,
  batchId: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: donation.id })
    .from(donation)
    .where(eq(donation.paymentBatchId, batchId));
  return row?.id;
}

/**
 * Foreign money a donation refused, from the system refund returning it:
 * how much, and when it was refused. Undefined for any other refund.
 */
export async function readForeignDonation(
  db: AppDb,
  refundId: string
): Promise<ForeignDonationFact | undefined> {
  const [row] = await db
    .select({
      gatewayPaymentId: refund.gatewayPaymentId,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      requestedAt: refund.requestedAt,
    })
    .from(refund)
    .innerJoin(donation, eq(donation.paymentBatchId, refund.batchId))
    .where(and(eq(refund.id, refundId), eq(refund.kind, "foreign_payment")));
  if (!row?.gatewayPaymentId) return undefined;
  if (row.currency !== "INR") throw new Error("Foreign money posts in INR");
  return {
    source: { type: "foreign_donation", id: row.gatewayPaymentId },
    occurredAt: row.requestedAt,
    amountMinor: row.amountMinor,
  };
}
