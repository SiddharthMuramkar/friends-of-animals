"use server";

import { updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { adminCompetitionCancelPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import type { CancelCompetitionResult } from "@/server/modules/competitions";
import { COMPETITION_TAGS } from "@/server/modules/competitions/cache-tags";
import { cancelCompetitionInput } from "@/server/modules/competitions/cancel-competition";
import { isCompetitionId } from "@/server/modules/competitions/manage";

import { afterCancel, type CancelFormState } from "./form-state";

// The cancel page's Server Action (#80). Cancelling moves money, so the
// use case asks for a second factor passed in the last 10 minutes (#60): a
// refusal sends the super admin to step up, then back to the page to send
// it again. Anything unexpected is logged by class only and shown as
// "nothing was cancelled".

/** Cancels the competition, then shows the page again, cancelled. */
export async function cancelCompetitionAction(
  previous: CancelFormState,
  formData: FormData
): Promise<CancelFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const fields = {
    competitionId: formData.get("competitionId"),
    reason: formData.get("reason"),
  };
  const parsed = cancelCompetitionInput.safeParse(fields);
  if (!isCompetitionId(fields.competitionId)) {
    return afterCancel(previous, "", { ok: false, error: "not_found" });
  }
  if (!parsed.success) {
    return afterCancel(previous, "", { ok: false, error: "reason_invalid" });
  }
  const { competitionId, reason } = parsed.data;
  const back = adminCompetitionCancelPath(competitionId);
  let result: CancelCompetitionResult;
  try {
    result = await as(actor).cancelCompetition(parsed.data);
  } catch (error) {
    if (error instanceof DomainError) {
      const path = secondFactorPath(error.code, back);
      if (path) redirect(path);
    }
    console.error(`cancelCompetition failed: ${errorSummaryForLogs(error)}`);
    return afterCancel(previous, reason, "unexpected");
  }
  if (result.ok) {
    updateTag(COMPETITION_TAGS.list);
    redirect(`${back}?done=cancelled`, RedirectType.replace);
  }
  return afterCancel(previous, reason, result);
}
