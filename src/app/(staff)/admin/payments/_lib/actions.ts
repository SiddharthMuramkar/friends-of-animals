"use server";

import { redirect, RedirectType } from "next/navigation";

import {
  adminPaymentBatchPath,
  adminPaymentReviewCasePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import type { Actor } from "@/server/actor";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import type {
  RecordOfflinePaymentResult,
  ResolvePaymentReviewCaseResult,
} from "@/server/modules/payments";

import {
  afterRecord,
  afterResolve,
  offlineEntered,
  uploadAlert,
  type OfflineAlert,
  type OfflineFormState,
  type ResolveFormState,
} from "./form-state";

// The payments admin pages' Server Actions (#79). Recording an offline
// payment and resolving a case move money, so the use cases ask for a
// second factor passed in the last 10 minutes (#60): a refusal sends the
// user to step up, then back to the page to submit again. Anything
// unexpected is logged by class only and shown as "nothing was saved".

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedIn(): Promise<Actor> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** Sends a second-factor refusal to the page that lifts it, then `back`. */
function liftSecondFactor(error: unknown, back: string): void {
  if (!(error instanceof DomainError)) return;
  const path = secondFactorPath(error.code, back);
  if (path) redirect(path);
}

/**
 * Accepts, refunds or keeps a payment in review (the pressed button says
 * which), then shows the case again with what happened. A problem with
 * the reason comes back to the form with what was typed.
 */
export async function resolveReviewCaseAction(
  previous: ResolveFormState,
  formData: FormData
): Promise<ResolveFormState> {
  const actor = await signedIn();
  const caseId = text(formData, "caseId");
  const outcome = text(formData, "outcome");
  const reason = text(formData, "reason");
  let result: ResolvePaymentReviewCaseResult;
  try {
    result = await as(actor).resolvePaymentReviewCase({
      caseId,
      outcome,
      reason,
    });
  } catch (error) {
    liftSecondFactor(error, adminPaymentReviewCasePath(caseId));
    console.error(
      `resolvePaymentReviewCase failed: ${errorSummaryForLogs(error)}`
    );
    return afterResolve(previous, reason, "unexpected");
  }
  if (result.ok) {
    redirect(
      `${adminPaymentReviewCasePath(caseId)}?done=${encodeURIComponent(outcome)}`,
      RedirectType.replace
    );
  }
  return afterResolve(previous, reason, result);
}

export type ProofUploadView =
  | {
      ok: true;
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }
  | { ok: false; alert: OfflineAlert };

/** Presigns the proof's upload for the person about to record the payment. */
export async function requestProofUploadAction(
  batchId: string,
  request: { contentType: string; sizeBytes: number }
): Promise<ProofUploadView> {
  const actor = await signedIn();
  try {
    const result = await as(actor).requestOfflinePaymentProofUpload({
      batchId,
      ...request,
    });
    if (!result.ok) return { ok: false, alert: uploadAlert(result.error) };
    return {
      ok: true,
      fileId: result.fileId,
      uploadUrl: result.uploadUrl,
      headers: result.headers,
    };
  } catch (error) {
    liftSecondFactor(error, adminPaymentBatchPath(batchId));
    console.error(
      `requestOfflinePaymentProofUpload failed: ${errorSummaryForLogs(error)}`
    );
    return { ok: false, alert: "unexpected" };
  }
}

/** Takes the proof once the browser has PUT it. */
export async function completeProofUploadAction(
  fileId: string
): Promise<{ ok: boolean }> {
  const actor = await signedIn();
  try {
    return { ok: (await as(actor).completeUpload({ fileId })).ok };
  } catch (error) {
    console.error(`completeUpload failed: ${errorSummaryForLogs(error)}`);
    return { ok: false };
  }
}

/**
 * Records the offline payment with the proof the island uploaded first,
 * then shows the batch, now paid. Problems come back to the form with
 * what was typed.
 */
export async function recordOfflinePaymentAction(
  previous: OfflineFormState,
  formData: FormData
): Promise<OfflineFormState> {
  const actor = await signedIn();
  const batchId = text(formData, "batchId");
  const entered = offlineEntered(formData);
  let result: RecordOfflinePaymentResult;
  try {
    result = await as(actor).recordOfflinePayment({
      batchId,
      ...entered,
      proofFileId: text(formData, "proofFileId"),
    });
  } catch (error) {
    liftSecondFactor(error, adminPaymentBatchPath(batchId));
    console.error(`recordOfflinePayment failed: ${errorSummaryForLogs(error)}`);
    return afterRecord(previous, entered, "unexpected");
  }
  if (result.ok) {
    redirect(
      `${adminPaymentBatchPath(batchId)}?recorded=1`,
      RedirectType.replace
    );
  }
  return afterRecord(previous, entered, result);
}

/**
 * Opens the batch's offline payment proof through a short-lived signed
 * link, or comes back to the batch saying why it can't.
 */
export async function openProofAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const batchId = text(formData, "batchId");
  const back = adminPaymentBatchPath(batchId);
  let destination: string;
  try {
    const result = await as(actor).getOfflinePaymentProof({ batchId });
    destination = result.ok
      ? result.url
      : `${back}?proof=${result.error === "invalid_input" ? "not_found" : result.error}`;
  } catch (error) {
    liftSecondFactor(error, back);
    if (!(error instanceof DomainError)) {
      console.error(
        `getOfflinePaymentProof failed: ${errorSummaryForLogs(error)}`
      );
    }
    destination = back;
  }
  redirect(destination);
}
