// Offline payments (#79): money FOA received by cheque, bank transfer or
// cash, recorded by finance against a payment batch.
//
//   requestOfflinePaymentProofUpload({ batchId, contentType, sizeBytes })
//                     → finance, staff admins, super admins (fresh factor)
//   recordOfflinePayment({ batchId, method, reference, amount, receivedOn,
//                          proofFileId })              → the same
//
// The proof (a photo or scan of the cheque, the bank's advice or the cash
// receipt) is a private file (#63), uploaded first by the person who then
// records the payment. Recording goes through the capture path
// (./capture.ts), so it has exactly the effect of an online capture: the
// batch is captured (`capture_method = offline`), its registrations are
// confirmed with their numbers, and the payer's receipt and each family's
// confirmation go to the outbox, in one transaction with the offline
// payment's row and its audit entry. Nothing is written when anything is
// refused (./domain/offline-capture.ts says what and in which order).

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { fileAsset, offlinePayment, paymentBatch } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { parseRupeesToPaise } from "../competitions/domain/fees";
import type { UploadRefusal } from "../files/domain/purposes";
import { presignUpload } from "../files/use-cases/upload";
import { lockBatch } from "./batches";
import { captureBatch, registrationsAtCapture } from "./capture";
import {
  decideOfflineCapture,
  type OfflineCaptureRefusal,
} from "./domain/offline-capture";
import {
  OFFLINE_PAYMENT_METHODS,
  type OfflinePaymentErrors,
} from "./domain/offline-payment";

export type RecordOfflinePaymentInput = {
  batchId: string;
  /** cheque, bank_transfer or cash. */
  method: string;
  reference: string;
  /** Rupees, as finance types them ("1,000", "₹1,000.50"). */
  amount: string;
  /** The calendar date in India the money arrived, `YYYY-MM-DD`. */
  receivedOn: string;
  /** The proof this user uploaded (requestOfflinePaymentProofUpload). */
  proofFileId: string;
};

export type RecordOfflinePaymentResult =
  | { ok: true; batchId: string; confirmed: number }
  | InvalidInput
  | { ok: false; error: "fields_invalid"; errors: OfflinePaymentErrors }
  | { ok: false; error: "not_found" | OfflineCaptureRefusal };

const recordInput = z.object({
  batchId: z.uuid(),
  method: z.enum(OFFLINE_PAYMENT_METHODS),
  reference: z.string().max(200),
  amount: z.string().max(40),
  receivedOn: z.string().max(40),
  proofFileId: z.uuid(),
});

export async function recordOfflinePayment(
  ctx: UseCaseContext,
  input: RecordOfflinePaymentInput
): Promise<RecordOfflinePaymentResult> {
  const { role } = await authorize(ctx, "payments.offline.record");
  const parsed = recordInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const recordedBy = ctx.actor.userId;
  const { batchId, method, reference, receivedOn, proofFileId } = parsed.data;
  // An amount that isn't one is reported with the other fields: as zero,
  // which the check refuses as an invalid amount.
  const amount = parseRupeesToPaise(parsed.data.amount);
  const amountMinor = amount.ok ? amount.paise : 0n;

  return ctx.db.transaction(async (tx): Promise<RecordOfflinePaymentResult> => {
    const batch = await lockBatch(tx, batchId);
    if (!batch) return { ok: false, error: "not_found" };
    const [proof] = await tx
      .select({
        ownerUserId: fileAsset.ownerUserId,
        purpose: fileAsset.purpose,
        status: fileAsset.status,
      })
      .from(fileAsset)
      .where(eq(fileAsset.id, proofFileId));
    const now = ctx.clock.now();
    const decision = decideOfflineCapture({
      batch: { status: batch.status, amountMinor: batch.amountMinor },
      registrations: await registrationsAtCapture(tx, ctx, batch),
      proof: proof ?? null,
      recordedBy,
      payment: { method, reference, amountMinor, receivedOn },
      now,
    });
    if (!decision.ok) {
      return decision.error === "fields_invalid"
        ? { ok: false, error: "fields_invalid", errors: decision.errors }
        : { ok: false, error: decision.error };
    }

    const offlinePaymentId = uuidv7(now);
    await tx.insert(offlinePayment).values({
      id: offlinePaymentId,
      batchId,
      method: decision.payment.method,
      reference: decision.payment.reference,
      amountMinor: decision.payment.amountMinor,
      receivedOn: decision.payment.receivedOn,
      proofFileAssetId: proofFileId,
      recordedByUserId: recordedBy,
      recordedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "payment.offline_recorded",
      entity: { type: "offline_payment", id: offlinePaymentId },
      before: null,
      after: {
        batchId,
        method: decision.payment.method,
        amountMinor: decision.payment.amountMinor.toString(),
        receivedOn: decision.payment.receivedOn,
        proofFileId,
      },
      actorRole: role,
    });
    const { confirmed } = await captureBatch(
      tx,
      ctx,
      batch,
      { event: "offline_recorded", method: "offline", gatewayPaymentId: null },
      role
    );
    return { ok: true, batchId, confirmed };
  });
}

export type RequestOfflinePaymentProofUploadInput = {
  batchId: string;
  contentType: string;
  sizeBytes: number;
};

export type RequestOfflinePaymentProofUploadResult =
  | {
      ok: true;
      /** Name it in recordOfflinePayment once completeUpload took it. */
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: Date;
    }
  | InvalidInput
  | { ok: false; error: "not_found" | UploadRefusal };

const proofInput = z.object({
  batchId: z.uuid(),
  contentType: z.string().max(200),
  sizeBytes: z.number(),
});

/**
 * Presigns the proof's upload for the person about to record the payment,
 * who becomes its owner. Only for a batch that exists.
 */
export async function requestOfflinePaymentProofUpload(
  ctx: UseCaseContext,
  input: RequestOfflinePaymentProofUploadInput
): Promise<RequestOfflinePaymentProofUploadResult> {
  await authorize(ctx, "payments.offline.record");
  const parsed = proofInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [batch] = await ctx.db
    .select({ id: paymentBatch.id })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, parsed.data.batchId));
  if (!batch) return { ok: false, error: "not_found" };
  return presignUpload(ctx, ctx.db, {
    purpose: "offline_payment_proof",
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
  });
}
