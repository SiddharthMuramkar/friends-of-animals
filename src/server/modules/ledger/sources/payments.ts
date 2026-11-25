import { and, eq, exists, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import {
  offlinePayment,
  paymentBatch,
  paymentReviewCase,
  refund,
} from "../../../db/schema";

import { parseIstDate } from "../domain/period";
import type { MoneyMethod } from "../domain/posting-rules";

export type CaptureFact = {
  source: { type: "payment_capture" | "offline_payment"; id: string };
  competitionId: string;
  occurredAt: Date;
  amountMinor: bigint;
  method: MoneyMethod;
};

const isOffline = sql`${paymentBatch.captureMethod} = 'offline'`;
export const captureSource = {
  type: sql<
    CaptureFact["source"]["type"]
  >`CASE WHEN ${isOffline} THEN 'offline_payment' ELSE 'payment_capture' END`,
  id: sql<
    string | null
  >`CASE WHEN ${isOffline} THEN ${offlinePayment.id}::text ELSE ${paymentBatch.gatewayPaymentId} END`,
};

export class UnsupportedCaptureCurrencyError extends Error {
  readonly code = "unsupported_currency";

  constructor() {
    super("Ledger capture requires INR");
    this.name = "UnsupportedCaptureCurrencyError";
  }
}

export function eligibleCapture(db: AppDb) {
  const openReview = db
    .select({ id: paymentReviewCase.id })
    .from(paymentReviewCase)
    .where(
      and(
        eq(paymentReviewCase.batchId, paymentBatch.id),
        eq(paymentReviewCase.batchStatusBefore, "captured"),
        isNull(paymentReviewCase.resolvedAt)
      )
    );

  // Before #80a, a duplicate could move a paid batch into needs_review
  // while its original capture remained on the batch. A donation's batch
  // (#106) posts from the donation instead (./donations.ts).
  return and(
    eq(paymentBatch.purpose, "registration_fee"),
    or(
      eq(paymentBatch.status, "captured"),
      and(
        eq(paymentBatch.status, "needs_review"),
        isNotNull(paymentBatch.capturedAt),
        or(
          isNotNull(paymentBatch.gatewayPaymentId),
          eq(paymentBatch.captureMethod, "offline")
        ),
        exists(openReview)
      )
    )
  );
}

export async function readCapture(
  db: AppDb,
  batchId: string
): Promise<CaptureFact | undefined> {
  const [row] = await db
    .select({
      competitionId: paymentBatch.competitionId,
      sourceType: captureSource.type,
      sourceId: captureSource.id,
      capturedAt: paymentBatch.capturedAt,
      amountMinor: paymentBatch.amountMinor,
      currency: paymentBatch.currency,
      offline: {
        method: offlinePayment.method,
        receivedOn: offlinePayment.receivedOn,
        amountMinor: offlinePayment.amountMinor,
      },
      acceptedReceipt: {
        amountMinor: paymentReviewCase.amountMinor,
        currency: paymentReviewCase.currency,
      },
    })
    .from(paymentBatch)
    .leftJoin(offlinePayment, eq(offlinePayment.batchId, paymentBatch.id))
    .leftJoin(
      paymentReviewCase,
      and(
        eq(paymentReviewCase.batchId, paymentBatch.id),
        eq(paymentReviewCase.gatewayPaymentId, paymentBatch.gatewayPaymentId),
        eq(paymentReviewCase.outcome, "confirm")
      )
    )
    .where(and(eq(paymentBatch.id, batchId), eligibleCapture(db)));
  if (!row) return undefined;
  if (row.currency !== "INR") throw new UnsupportedCaptureCurrencyError();
  const { competitionId } = row;
  if (competitionId === null)
    throw new Error("A fee capture has no competition");

  if (row.sourceType === "offline_payment") {
    if (!row.sourceId || !row.offline)
      throw new Error("Captured batch has no offline payment");
    const received = parseIstDate(row.offline.receivedOn);
    if (!received.ok)
      throw new Error("Offline payment has an invalid receipt date");
    if (row.offline.amountMinor !== row.amountMinor)
      throw new Error("Offline payment differs from the captured batch");
    return {
      source: { type: row.sourceType, id: row.sourceId },
      competitionId,
      occurredAt: received.start,
      amountMinor: row.offline.amountMinor,
      method: row.offline.method,
    };
  }

  // Captures made before #79 have no capture method and used the gateway.
  if (!row.sourceId || !row.capturedAt)
    throw new Error("Captured batch has no gateway capture");
  // Payments keeps the order total when finance confirms a different receipt.
  if (row.acceptedReceipt && row.acceptedReceipt.currency !== "INR")
    throw new UnsupportedCaptureCurrencyError();
  return {
    source: { type: row.sourceType, id: row.sourceId },
    competitionId,
    occurredAt: row.capturedAt,
    amountMinor: row.acceptedReceipt?.amountMinor ?? row.amountMinor,
    method: "gateway",
  };
}

export async function readProcessedRefund(db: AppDb, refundId: string) {
  const [row] = await db
    .select({
      batchId: refund.batchId,
      kind: refund.kind,
      gatewayPaymentId: refund.gatewayPaymentId,
      manualMethod: refund.manualMethod,
      method: refund.method,
      currency: refund.currency,
      amountMinor: refund.amountMinor,
      occurredAt: refund.refundedAt,
    })
    .from(refund)
    .where(and(eq(refund.id, refundId), eq(refund.status, "refunded")));
  // A duplicate returns money held in review. It did not capture this
  // batch's fees, so there is no original ledger entry to reverse (HR-47).
  if (!row || row.kind === "duplicate") return undefined;
  if (!row.occurredAt || row.currency !== "INR")
    throw new Error("Invalid processed refund for ledger");
  return { ...row, occurredAt: row.occurredAt };
}
