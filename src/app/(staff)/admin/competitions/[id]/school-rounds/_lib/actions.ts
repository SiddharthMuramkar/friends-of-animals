"use server";

import { redirect, RedirectType } from "next/navigation";
import { adminSchoolRoundsPath, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { isCompetitionId } from "@/server/modules/competitions/manage";

export async function changeSchoolRoundAction(formData: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const competitionId = formData.get("competitionId");
  const roundId = formData.get("roundId");
  if (typeof competitionId !== "string" || !isCompetitionId(competitionId))
    redirect(APP_ROUTES.adminCompetitions);
  const back = adminSchoolRoundsPath(competitionId);
  let done = "invalid_input";
  if (typeof roundId === "string") {
    const ref = { competitionId, roundId };
    try {
      if (formData.get("operation") === "close") {
        const reason = formData.get("reason");
        if (typeof reason === "string") {
          const result = await as(actor).closeSchoolRoundOnBehalf({
            ...ref,
            reason,
          });
          done = result.ok ? "closed" : result.error;
        }
      } else if (formData.get("operation") === "reopen") {
        const result = await as(actor).reopenSchoolRound(ref);
        done = result.ok ? "reopened" : result.error;
      }
    } catch (error) {
      done =
        error instanceof DomainError && error.code === "forbidden"
          ? "forbidden"
          : "failed";
      if (done === "failed")
        console.error(
          `school round action failed: ${errorSummaryForLogs(error)}`
        );
    }
  }
  redirect(`${back}?done=${done}`, RedirectType.replace);
}
