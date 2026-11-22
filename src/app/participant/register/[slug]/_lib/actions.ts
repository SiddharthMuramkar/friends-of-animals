"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES, payMyRegistrationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { RegisterAsIndividualResult } from "@/server/modules/participants";

import { afterResult, valuesFrom, type RegisterFormState } from "./form-state";

/**
 * Registers the signed-in member, or the child they named (#81), for the
 * competition, then takes whoever pays to pay for it; a registration held
 * for a guardian, or one a teen's guardian pays, goes to the dashboard. A
 * refusal comes back to the form with what was typed.
 */
export async function registerAsIndividualAction(
  competitionSlug: string,
  forChildId: string | null,
  previous: RegisterFormState,
  formData: FormData
): Promise<RegisterFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const values = valuesFrom(formData);
  const { guardianName, guardianRelationship, guardianEmail, ...own } = values;
  let result: RegisterAsIndividualResult;
  try {
    result = await as(actor).registerAsIndividual({
      competitionSlug,
      ...own,
      ...(forChildId === null ? {} : { forChildId }),
      guardian: {
        fullName: guardianName,
        relationship: guardianRelationship,
        email: guardianEmail,
      },
    });
  } catch (error) {
    console.error(`registerAsIndividual failed: ${errorSummaryForLogs(error)}`);
    return afterResult(previous, values, "unexpected");
  }
  if (result.ok) {
    // Re-renders the header too, which now leads to "My competitions".
    refresh();
    const { registrationId } = result;
    const owed =
      result.status === "pending_payment" &&
      (await as(actor).listMyRegistrations()).some(
        (mine) => mine.registrationId === registrationId && mine.amountDue
      );
    redirect(
      owed ? payMyRegistrationPath(registrationId) : APP_ROUTES.participant
    );
  }
  return afterResult(previous, values, result);
}
