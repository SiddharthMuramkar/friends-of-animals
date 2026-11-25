// What a donation's payments do (#106): the donations module's handler for
// payment batches of purpose `donation` (../payments/purposes.ts). Payments
// keeps the one funnel every signal goes through (signature, replay
// guard, the gateway's own record, the batch lock); this decides what the
// order's payments mean for the donation, in the funnel's transaction:
//
// - sync: a domestic INR payment for the full amount captures the donation
//   and its batch, and numbers its receipt (./receipts/issue.ts). Foreign
//   INR money while FCRA is off is refunded in full at once (a system
//   refund of kind `foreign_payment`) and held as owed back in the ledger;
//   the donation gets no receipt. Anything else (a wrong amount, foreign
//   money in another currency, a second payment, money after expiry) goes
//   to payment review (#79), never refunded automatically.
// - acceptReviewed: finance accepted, in review, money that arrived after
//   the donation expired: it captures the donation with its receipt.
// - refundSettled: a refund of the batch reached `refunded`: a foreign
//   payment went back, or finance refunded the donation, which cancels
//   its receipt once nothing is left. The donor is told either way.
//
// Each change writes its audit entry and outbox events in the same
// transaction. Loads under plain Node (the worker): relative imports only.

import { and, eq, inArray, sql, sum } from "drizzle-orm";
import { createTranslator } from "next-intl";

import donationsMessages from "../../../../messages/en-IN/donations.json";
import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  donation,
  paymentBatch,
  receipt,
  recurringRefusedCharge,
  refund,
  type PaymentBatchRow,
} from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import type { GatewayPayment } from "../../ports/payment-gateway";
import type { Settings } from "../../ports/settings";
import { lockBatch } from "../payments/batches";
import {
  nextPaymentBatchStatus,
  type PaymentBatchEvent,
} from "../payments/domain/batch-status";
import type { SyncOutcome } from "../payments/domain/outcomes";
import { knownPaymentIds, openReviewCases } from "../payments/open-review-case";
import { startSystemRefund } from "../payments/refunds/start-system-refund";
import { decideDonationPayments } from "./domain/donation-capture";
import {
  holdsMoney,
  nextDonationStatus,
  type DonationEvent,
} from "./domain/donation-status";
import { readSetting } from "../settings/read";
import { issueReceipt } from "./receipts/issue";

const t = createTranslator({
  locale: "en-IN",
  messages: donationsMessages,
  namespace: "donations.refundReasons",
});

type PaymentsContext = {
  db: AppDb;
  clock: Clock;
  actor: Actor;
  cipher: FieldCipher;
  settings: Settings;
};

/** The donation a batch pays for, locked until the transaction ends. */
async function lockDonationOf(tx: AppDb, batchId: string) {
  const [row] = await tx
    .select()
    .from(donation)
    .where(eq(donation.paymentBatchId, batchId))
    .for("update");
  if (!row) throw new Error(`Batch ${batchId} pays for no donation`);
  return row;
}

type DonationRow = Awaited<ReturnType<typeof lockDonationOf>>;

/** Moves the donation by `event`, audited; throws if the machine forbids. */
async function moveDonation(
  tx: AppDb,
  ctx: Pick<PaymentsContext, "clock" | "actor">,
  row: DonationRow,
  event: DonationEvent,
  actorRole: Role | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  const move = nextDonationStatus(row.status, event);
  if (!move.ok) throw new Error(`Donation ${row.id} can't take ${event}`);
  await tx
    .update(donation)
    .set({ status: move.to, updatedAt: ctx.clock.now() })
    .where(eq(donation.id, row.id));
  await recordAudit(tx, ctx, {
    action: "donation.status_changed",
    entity: { type: "donation", id: row.id },
    before: { status: row.status },
    after: { status: move.to, event, ...details },
    actorRole,
  });
}

/**
 * Captures the donation with `gatewayPaymentId`: its status, its batch's,
 * and its receipt with the next number, in the caller's transaction.
 */
export async function captureDonation(
  tx: AppDb,
  ctx: PaymentsContext,
  input: {
    batch: PaymentBatchRow;
    row: DonationRow;
    gatewayPaymentId: string;
    capturedAt?: Date;
    event: Extract<DonationEvent, "captured" | "late_capture_accepted">;
    batchEvent: Extract<PaymentBatchEvent, "captured" | "review_confirmed">;
  },
  actorRole: Role | null
): Promise<void> {
  const { batch, row, gatewayPaymentId } = input;
  const move = nextDonationStatus(row.status, input.event);
  const batchMove = nextPaymentBatchStatus(batch.status, input.batchEvent);
  if (!move.ok || !batchMove.ok) {
    throw new Error(`Donation ${row.id} can't be captured`);
  }
  const now = ctx.clock.now();
  const capturedAt = input.capturedAt ?? now;
  await tx
    .update(paymentBatch)
    .set({
      status: batchMove.to,
      captureMethod: "gateway",
      gatewayPaymentId,
      capturedAt,
      updatedAt: now,
    })
    .where(eq(paymentBatch.id, batch.id));
  await recordAudit(tx, ctx, {
    action: "payment.batch_captured",
    entity: { type: "payment_batch", id: batch.id },
    before: { status: batch.status },
    after: {
      status: batchMove.to,
      purpose: "donation",
      captureMethod: "gateway",
      gatewayPaymentId,
      capturedAt: capturedAt.toISOString(),
    },
    actorRole,
  });
  await tx
    .update(donation)
    .set({ status: move.to, gatewayPaymentId, capturedAt, updatedAt: now })
    .where(eq(donation.id, row.id));
  const issued = await issueReceipt(tx, ctx, {
    donationId: row.id,
    donorId: row.donorId,
    amountMinor: row.amountMinor,
    gatewayPaymentId,
    issuedAt: now,
  });
  await recordAudit(tx, ctx, {
    action: "donation.captured",
    entity: { type: "donation", id: row.id },
    before: { status: row.status },
    after: {
      status: move.to,
      event: input.event,
      gatewayPaymentId,
      receiptId: issued.id,
    },
    actorRole,
  });
  await recordAudit(tx, ctx, {
    action: "receipt.issued",
    entity: { type: "receipt", id: issued.id },
    before: null,
    after: { donationId: row.id, number: issued.number },
    actorRole,
  });
  await emit(tx, ctx.clock, {
    type: "donation.captured",
    aggregate: { type: "donation", id: row.id },
    payload: { donationId: row.id },
  });
}

/** Foreign payments the batch already refused: never refused again. */
async function refusedForeignPaymentIds(
  tx: AppDb,
  batchId: string
): Promise<string[]> {
  const rows = await tx
    .select({ paymentId: refund.gatewayPaymentId })
    .from(refund)
    .where(
      and(eq(refund.batchId, batchId), eq(refund.kind, "foreign_payment"))
    );
  return rows.flatMap((row) => (row.paymentId ? [row.paymentId] : []));
}

export async function syncDonationBatch(
  tx: AppDb,
  ctx: PaymentsContext,
  batch: PaymentBatchRow,
  payments: readonly GatewayPayment[],
  actorRole: Role | null
): Promise<SyncOutcome> {
  const row = await lockDonationOf(tx, batch.id);
  if (!batch.gatewayOrderId) return "awaiting_payment";
  const decision = decideDonationPayments(row, payments, {
    orderId: batch.gatewayOrderId,
    knownPaymentIds: [
      ...(await knownPaymentIds(tx, batch)),
      ...(await refusedForeignPaymentIds(tx, batch.id)),
    ],
    // Read in the transaction: the settings port has its own connection.
    fcraEnabled: await readSetting(tx, "org.fcraEnabled"),
  });

  for (const payment of decision.refundForeign) {
    const started = await startSystemRefund(tx, ctx, {
      kind: "foreign_payment",
      batchId: batch.id,
      gatewayPaymentId: payment.id,
      amountMinor: payment.amountMinor,
      reason: t("foreign"),
      idempotencyKey: `foreign:${batch.id}:${payment.id}`,
      actorRole,
    });
    if (!("refundId" in started)) {
      throw new Error(`Batch ${batch.id}: no refund for a foreign payment`);
    }
    const { refundId } = started;
    await recordAudit(tx, ctx, {
      action: "donation.foreign_payment_refused",
      entity: { type: "donation", id: row.id },
      before: null,
      after: {
        gatewayPaymentId: payment.id,
        refundId,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
        international: payment.international,
      },
      actorRole,
    });
    await emit(tx, ctx.clock, {
      type: "donation.foreign_payment_received",
      aggregate: { type: "donation", id: row.id },
      payload: { donationId: row.id, refundId },
    });
  }

  if (decision.capture) {
    await captureDonation(
      tx,
      ctx,
      {
        batch,
        row,
        gatewayPaymentId: decision.capture,
        event: "captured",
        batchEvent: "captured",
      },
      actorRole
    );
  } else if (decision.event) {
    await moveDonation(tx, ctx, row, decision.event, actorRole);
  }

  if (decision.review.length > 0) {
    // After a capture the batch is captured, and stays so beside the case.
    const current = await lockBatch(tx, batch.id);
    if (!current) throw new Error(`Batch ${batch.id} vanished`);
    const named = new Map(payments.map((payment) => [payment.id, payment]));
    await openReviewCases(
      tx,
      ctx,
      current,
      decision.review.map(({ paymentId, reason }) => {
        const payment = named.get(paymentId);
        if (!payment) throw new Error(`No payment ${paymentId} on the order`);
        return { payment, reason };
      }),
      actorRole
    );
  }

  if (decision.capture) return "captured";
  if (decision.review.length > 0) return "needs_review";
  if (decision.refundForeign.length > 0) return "refunding_foreign";
  return holdsMoney(row.status) ? "already_captured" : "awaiting_payment";
}

/**
 * Finance accepted the reviewed payment of an expired donation: the
 * donation and its batch are captured, with the next receipt number.
 */
export async function acceptReviewedDonation(
  tx: AppDb,
  ctx: PaymentsContext,
  batch: PaymentBatchRow,
  gatewayPaymentId: string,
  actorRole: Role | null
): Promise<void> {
  const row = await lockDonationOf(tx, batch.id);
  await captureDonation(
    tx,
    ctx,
    {
      batch,
      row,
      gatewayPaymentId,
      event: "late_capture_accepted",
      batchEvent: "review_confirmed",
    },
    actorRole
  );
}

/**
 * A refund of the donation's batch reached `refunded`, in the transaction
 * that marks it. A duplicate (a second payment returned from review)
 * leaves the donation as it is.
 */
export async function settleDonationRefund(
  tx: AppDb,
  ctx: Pick<PaymentsContext, "clock" | "actor">,
  refundId: string,
  actorRole: Role | null
): Promise<void> {
  const [returned] = await tx
    .select({
      batchId: refund.batchId,
      kind: refund.kind,
      gatewayPaymentId: refund.gatewayPaymentId,
    })
    .from(refund)
    .where(eq(refund.id, refundId));
  if (!returned || returned.kind === "duplicate") return;
  const [refused] = await tx
    .select()
    .from(recurringRefusedCharge)
    .where(eq(recurringRefusedCharge.refundId, refundId));
  if (refused) {
    await emit(tx, ctx.clock, {
      type: "recurring_donation.refunded",
      aggregate: {
        type: "recurring_donation",
        id: refused.recurringDonationId,
      },
      payload: { id: refused.recurringDonationId },
    });
    return;
  }
  const row = await lockDonationOf(tx, returned.batchId);

  const foreign = returned.kind === "foreign_payment";
  if (foreign) {
    // The donation's own money only if it never captured another payment.
    if (row.status === "refund_pending") {
      await moveDonation(tx, ctx, row, "refund_processed_in_full", actorRole, {
        refundId,
      });
    }
  } else {
    const [given] = await tx
      .select({ total: sum(refund.amountMinor) })
      .from(refund)
      .where(
        and(
          eq(refund.batchId, returned.batchId),
          eq(refund.status, "refunded"),
          inArray(refund.kind, ["discretionary", "cancellation"]),
          sql`${refund.gatewayPaymentId} IS NOT DISTINCT FROM ${row.gatewayPaymentId}`
        )
      );
    const refundedMinor = BigInt(given?.total ?? 0);
    const inFull = refundedMinor >= row.amountMinor;
    await moveDonation(
      tx,
      ctx,
      row,
      inFull ? "refund_processed_in_full" : "refund_processed_in_part",
      actorRole,
      { refundId, refundedMinor: refundedMinor.toString() }
    );
    if (inFull) {
      const now = ctx.clock.now();
      const [cancelled] = await tx
        .update(receipt)
        .set({ cancelledAt: now })
        .where(
          and(
            eq(receipt.donationId, row.id),
            sql`${receipt.cancelledAt} IS NULL`
          )
        )
        .returning({ id: receipt.id, number: receipt.number });
      if (cancelled) {
        await recordAudit(tx, ctx, {
          action: "receipt.cancelled",
          entity: { type: "receipt", id: cancelled.id },
          before: { cancelledAt: null },
          after: {
            cancelledAt: now.toISOString(),
            number: cancelled.number,
            refundId,
          },
          actorRole,
        });
      }
    }
  }
  await emit(tx, ctx.clock, {
    type: "donation.refunded",
    aggregate: { type: "donation", id: row.id },
    payload: { donationId: row.id, refundId },
  });
}
