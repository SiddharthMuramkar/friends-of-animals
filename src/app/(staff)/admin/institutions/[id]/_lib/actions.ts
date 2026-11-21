"use server";

import { redirect, RedirectType } from "next/navigation";

import { adminInstitutionPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { DecideInstitutionResult } from "@/server/institutions";

import {
  afterDecision,
  decisionFrom,
  type DecisionFormState,
} from "./decision-state";

/**
 * Verifies, rejects or suspends the institution (the pressed button says
 * which), then shows its page again with what happened. A problem with
 * the reason comes back to the form with what was typed.
 */
export async function decideInstitutionAction(
  previous: DecisionFormState,
  formData: FormData
): Promise<DecisionFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const input = decisionFrom(formData);
  if (!input) return afterDecision(previous, "", "unexpected");
  let result: DecideInstitutionResult;
  try {
    result = await as(actor).decideInstitution(input);
  } catch (error) {
    console.error(`decideInstitution failed: ${errorSummaryForLogs(error)}`);
    return afterDecision(previous, input.reason, "unexpected");
  }
  if (result.ok) {
    redirect(
      `${adminInstitutionPath(input.institutionId)}?decided=${result.outcome}`,
      RedirectType.replace
    );
  }
  return afterDecision(previous, input.reason, result);
}
