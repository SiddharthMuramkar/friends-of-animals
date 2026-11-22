"use server";

import { redirect } from "next/navigation";

import { payMyRegistrationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { RegisterAsIndividualResult } from "@/server/modules/participants";

import { afterResult, valuesFrom, type RegisterFormState } from "./form-state";

/**
 * Registers the signed-in adult for the competition, then takes them to
 * pay for it. A refusal comes back to the form with what was typed.
 */
export async function registerAsIndividualAction(
  competitionSlug: string,
  previous: RegisterFormState,
  formData: FormData
): Promise<RegisterFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const values = valuesFrom(formData);
  let result: RegisterAsIndividualResult;
  try {
    result = await as(actor).registerAsIndividual({
      competitionSlug,
      ...values,
    });
  } catch (error) {
    console.error(`registerAsIndividual failed: ${errorSummaryForLogs(error)}`);
    return afterResult(previous, values, "unexpected");
  }
  if (result.ok) redirect(payMyRegistrationPath(result.registrationId));
  return afterResult(previous, values, result);
}
