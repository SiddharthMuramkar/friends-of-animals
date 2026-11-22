// Recording an offline payment against a payment batch (#79): the whole
// decision, before anything is written. Pure; the use case loads the batch
// (locked), its registrations and the proof file, asks this, then writes.

import type { FileStatus } from "../../files/domain/file-status";
import type { FilePurpose } from "../../files/domain/purposes";
import type { PaymentBatchStatus } from "./batch-status";
import type {
  OfflinePaymentErrors,
  OfflinePaymentInput,
} from "./offline-payment";
import type { RegistrationAtCapture } from "./review-case";

/** Everything the decision reads. */
export type OfflineCapture = {
  batch: { status: PaymentBatchStatus; amountMinor: bigint };
  /** The registrations the batch would confirm. */
  registrations: readonly RegistrationAtCapture[];
  /** The proof file named in the form, or null if there's no such file. */
  proof: {
    ownerUserId: string;
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
