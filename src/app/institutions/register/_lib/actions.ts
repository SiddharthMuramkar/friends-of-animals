"use server";

import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { RegisterInstitutionResult } from "@/server/institutions";

import {
  afterResult,
  valuesFrom,
  type RegistrationFormState,
} from "./form-state";

/**
 * Registers the institution, then shows the person its page. A refused
 * field or an open registration comes back to the form with what was
 * typed.
 */
export async function registerInstitutionAction(
  previous: RegistrationFormState,
  formData: FormData
): Promise<RegistrationFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const values = valuesFrom(formData);
  let result: RegisterInstitutionResult;
  try {
    result = await as(actor).registerInstitution(values);
  } catch (error) {
    console.error(`registerInstitution failed: ${errorSummaryForLogs(error)}`);
    return afterResult(previous, values, "unexpected");
  }
  if (result.ok) redirect(`${APP_ROUTES.myInstitution}?registered=1`);
  return afterResult(previous, values, result);
}
