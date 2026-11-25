"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  JUDGE_DASHBOARD,
  judgeInvitationPath,
  judgeOnboardingPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { isWellFormedLinkToken } from "@/server/crypto/link-token";
const field = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
export async function respondJudgeAction(form: FormData) {
  const token = field(form, "token");
  if (!isWellFormedLinkToken(token)) redirect(JUDGE_DASHBOARD);
  const actor = await currentActor();
  const path = judgeInvitationPath(token);
  if (actor.kind !== "user")
    redirect(`${ROUTES.signIn.path}?next=${encodeURIComponent(path)}`);
  const api = as(actor);
  const op = field(form, "operation");
  let done = "invalid_input";
  let target = path;
  try {
    if (op === "accept" || op === "decline") {
      const result =
        op === "accept"
          ? await api.acceptJudgeInvitation({ token })
          : await api.declineJudgeInvitation({ token });
      done = result.ok
        ? op === "accept"
          ? "accepted"
          : "declined"
        : result.error;
      if (result.ok && op === "accept")
        target = judgeOnboardingPath(result.roundId);
    }
  } catch (error) {
    done = error instanceof DomainError ? error.code : "failed";
    if (!(error instanceof DomainError))
      console.error(`Judge response failed: ${errorSummaryForLogs(error)}`);
  }
  redirect(`${target}?done=${done}`);
}
export async function onboardJudgeAction(form: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const roundId = field(form, "roundId");
  if (!z.uuid().safeParse(roundId).success) redirect(JUDGE_DASHBOARD);
  const api = as(actor);
  const op = field(form, "operation");
  let done = "invalid_input";
  try {
    if (
      op === "terms" &&
      form.get("conduct") === "on" &&
      form.get("confidentiality") === "on"
    ) {
      const result = await api.acceptJudgeTerms({
        roundId,
        conductDocumentId: field(form, "conductDocumentId"),
        confidentialityDocumentId: field(form, "confidentialityDocumentId"),
      });
      done = result.ok ? "acceptedTerms" : result.error;
    } else if (op === "conflicts") {
      const choice = field(form, "none");
      const institutions = form
        .getAll("institutionIds")
        .filter((v): v is string => typeof v === "string");
      const statement = field(form, "statement");
      if (choice === "yes" || choice === "no") {
        const result = await api.declareConflicts({
          roundId,
          declaration:
            choice === "yes"
              ? { none: true }
              : { none: false, institutionIds: institutions, statement },
        });
        done = result.ok ? "declared" : result.error;
      }
    }
  } catch (error) {
    done = error instanceof DomainError ? error.code : "failed";
    if (!(error instanceof DomainError))
      console.error(`Judge onboarding failed: ${errorSummaryForLogs(error)}`);
  }
  redirect(`${judgeOnboardingPath(roundId)}?done=${done}`);
}
