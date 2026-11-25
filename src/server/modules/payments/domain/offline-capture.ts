// Recording an offline payment against a payment batch (#79): the whole
// decision, before anything is written. Pure; the use case loads the batch
// (locked), its registrations and the proof file, asks this, then writes.

import type { FileStatus } from "../../files/domain/file-status";
import type { FilePurpose } from "../../files/domain/purposes";
import type { PaymentBatchStatus } from "./batch-status";
import {
  checkOfflinePayment,
  type OfflinePaymentErrors,
  type OfflinePaymentInput,
} from "./offline-payment";
import type { RegistrationAtCapture } from "./review-case";

/** Everything the decision reads. */
export type OfflineCapture = {
  batch: { status: PaymentBatchStatus; amountMinor: bigint };
  /** The registrations the batch would confirm. */
  registrations: readonly RegistrationAtCapture[];
  /** The proof file named in the form, or null if there's no such file. */
  proof: {
    ownerUserId: string | null;
    purpose: FilePurpose;
    status: FileStatus;
  } | null;
  /** The finance user recording the payment. */
  recordedBy: string;
  payment: OfflinePaymentInput;
  now: Date;
};

export type OfflineCaptureRefusal =
  | "already_paid"
  | "batch_not_payable"
  | "proof_invalid"
  | "registration_not_payable";

export type OfflineCaptureDecision =
  | { ok: true; payment: OfflinePaymentInput }
  | { ok: false; error: "fields_invalid"; errors: OfflinePaymentErrors }
  | { ok: false; error: OfflineCaptureRefusal };

/** The proof statuses an offline payment may be recorded with. The scan
 * may still be running: delivery stays gated on it (63a), but money isn't
 * held up by the scanner. */
const PROOF_STATUSES_ACCEPTED: ReadonlySet<FileStatus> = new Set<FileStatus>([
  "uploaded",
  "scanning",
  "clean",
]);

/**
 * Whether finance may record this offline payment, checked in order: the
 * batch, then the fields (all reported at once), then the proof, then the
 * registrations. A closed registration window doesn't stop it: the money
 * arrived, and FOA decided to take it by recording it.
 */
export function decideOfflineCapture(
  capture: OfflineCapture
): OfflineCaptureDecision {
  const { batch, proof, registrations } = capture;
  if (batch.status === "captured") return { ok: false, error: "already_paid" };
  if (batch.status !== "created" && batch.status !== "order_created") {
    return { ok: false, error: "batch_not_payable" };
  }

  const checked = checkOfflinePayment(capture.payment, {
    batchAmountMinor: batch.amountMinor,
    now: capture.now,
  });
  if (!checked.ok) {
    return { ok: false, error: "fields_invalid", errors: checked.errors };
  }

  if (
    proof === null ||
    proof.ownerUserId !== capture.recordedBy ||
    proof.purpose !== "offline_payment_proof" ||
    !PROOF_STATUSES_ACCEPTED.has(proof.status)
  ) {
    return { ok: false, error: "proof_invalid" };
  }

  const payable =
    registrations.length > 0 &&
    registrations.every(
      (registration) =>
        registration.standing === "awaiting_payment" &&
        registration.heldByThisBatch
    );
  if (!payable) return { ok: false, error: "registration_not_payable" };

  return { ok: true, payment: checked.payment };
}
