"use server";

import { redirect, RedirectType } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { RegisterInstitutionForCompetitionResult } from "@/server/modules/registration";

import { registerOutcome } from "./register-state";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Registers the institution for one competition, then goes back to the
 * list saying what happened. `n` is new each time, so a second outcome in
 * a row is announced too. Anything unexpected (the database) says
 * "Something went wrong" instead of losing the page.
 */
export async function registerForCompetitionAction(
  formData: FormData
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const institutionId = field(formData, "institutionId");
  const competitionId = field(formData, "competitionId");
  let result: RegisterInstitutionForCompetitionResult | undefined;
  try {
    result = await as(actor).registerInstitutionForCompetition({
      institutionId,
      competitionId,
    });
  } catch (error) {
    console.error(
      `registerInstitutionForCompetition failed: ${errorSummaryForLogs(error)}`
    );
  }
  const query = new URLSearchParams({
    institution: institutionId,
    competition: competitionId,
    done: registerOutcome(result),
    n: Date.now().toString(36),
  });
  redirect(
    `${APP_ROUTES.institutionCompetitions}?${query.toString()}`,
    RedirectType.replace
  );
}
