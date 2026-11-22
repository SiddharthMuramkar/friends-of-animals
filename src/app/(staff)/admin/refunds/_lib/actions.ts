"use server";

import { redirect, RedirectType } from "next/navigation";

import { adminBatchRefundPath, adminRefundPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import type { Actor } from "@/server/actor";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import type {
  ApproveRefundResult,
  RecordManualRefundResult,
  RejectRefundResult,
  RequestRefundResult,
  RetryRefundResult,
} from "@/server/modules/payments";

import {
  afterDecision,
  afterManual,
  afterRequest,
  type DecisionFormState,
  type ManualFormState,
  type RequestFormState,
} from "./form-state";

// The refund pages' Server Actions (#80). Deciding, retrying and recording
// a refund move money, so the use cases ask for a second factor passed in
// the last 10 minutes (#60): a refusal sends the user to step up, then back
// to the page to submit again. Anything unexpected is logged by class only
// and shown as "nothing was saved".

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
 * Asks for the refund of the ticked students (none ticked: every student
 * left), then shows the batch's refund page with the request listed.
 */
export async function requestRefundAction(
  previous: RequestFormState,
  formData: FormData
): Promise<RequestFormState> {
  const actor = await signedIn();
  const batchId = text(formData, "batchId");
  const entered = {
    reason: text(formData, "reason"),
    registrationIds: formData
      .getAll("registrationId")
      .filter((value): value is string => typeof value === "string"),
  };
  let result: RequestRefundResult;
  try {
    result = await as(actor).requestRefund({
      batchId,
      reason: entered.reason,
      ...(entered.registrationIds.length > 0
        ? { registrationIds: entered.registrationIds }
        : {}),
    });
  } catch (error) {
    liftSecondFactor(error, adminBatchRefundPath(batchId));
    console.error(`requestRefund failed: ${errorSummaryForLogs(error)}`);
    return afterRequest(previous, entered, "unexpected");
  }
  if (result.ok) {
    redirect(`${adminBatchRefundPath(batchId)}?sent=1`, RedirectType.replace);
  }
  return afterRequest(previous, entered, result);
}

/**
 * Approves, rejects, retries or closes a refund (the pressed button says
 * which), then shows the refund again with what happened.
 */
export async function decideRefundAction(
  previous: DecisionFormState,
  formData: FormData
): Promise<DecisionFormState> {
  const actor = await signedIn();
  const refundId = text(formData, "refundId");
  const decision = text(formData, "decision");
  const note = text(formData, "note");
  let result: ApproveRefundResult | RejectRefundResult | RetryRefundResult;
  try {
    const refunds = as(actor);
    result =
      decision === "approve"
        ? await refunds.approveRefund({ refundId, note })
        : decision === "retry"
          ? await refunds.retryRefund({ refundId })
          : await refunds.rejectRefund({ refundId, note });
  } catch (error) {
    liftSecondFactor(error, adminRefundPath(refundId));
    console.error(`deciding a refund failed: ${errorSummaryForLogs(error)}`);
    return afterDecision(previous, note, "unexpected");
  }
  if (result.ok) {
    const done =
      decision === "approve"
        ? "approved"
        : decision === "retry"
          ? "retried"
          : "rejected";
    redirect(`${adminRefundPath(refundId)}?done=${done}`, RedirectType.replace);
  }
  return afterDecision(previous, note, result);
}

/** Records how a refund paid back by hand was paid, then shows it refunded. */
export async function recordManualRefundAction(
  previous: ManualFormState,
  formData: FormData
): Promise<ManualFormState> {
  const actor = await signedIn();
  const refundId = text(formData, "refundId");
  const entered = {
    method: text(formData, "method"),
    reference: text(formData, "reference"),
  };
  let result: RecordManualRefundResult;
  try {
    result = await as(actor).recordManualRefund({ refundId, ...entered });
  } catch (error) {
    liftSecondFactor(error, adminRefundPath(refundId));
    console.error(`recordManualRefund failed: ${errorSummaryForLogs(error)}`);
    return afterManual(previous, entered, "unexpected");
  }
  if (result.ok) {
    redirect(
      `${adminRefundPath(refundId)}?done=recorded`,
      RedirectType.replace
    );
  }
  return afterManual(previous, entered, result);
}
