"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_JUDGING_ROUNDS, adminJudgingRoundPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { AWARD_SCHEMES } from "@/server/modules/competitions/domain/award-schemes";
import { ROUND_OUTCOMES } from "@/server/modules/judging/domain/outcomes";
import { JUDGING_LEVELS } from "@/server/modules/judging/domain/round-settings";
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
const settings = z.object({
  name: z.string().trim().min(1).max(120),
  level: z.enum(JUDGING_LEVELS),
  judgesPhysical: z.boolean(),
  awardScheme: z.enum(AWARD_SCHEMES).optional(),
  sourceRoundId: z.union([z.uuid(), z.literal("verified_entries")]),
});
export async function roundAction(form: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const api = as(actor);
  const operation = text(form, "operation");
  const roundId = text(form, "roundId");
  const competitionId = text(form, "competitionId");
  const base = z.uuid().safeParse(roundId).success
    ? adminJudgingRoundPath(roundId)
    : ADMIN_JUDGING_ROUNDS;
  let target = base;
  let done = "invalid_input";
  let counts: Record<string, string> = {};
  try {
    if (operation === "create" || operation === "update") {
      const parsed = settings.safeParse({
        name: text(form, "name"),
        level: text(form, "level"),
        judgesPhysical: form.get("judgesPhysical") === "on",
        sourceRoundId: text(form, "sourceRoundId"),
        awardScheme:
          text(form, "awardScheme") === "competition_default"
            ? undefined
            : text(form, "awardScheme"),
      });
      if (operation === "create") target = `${ADMIN_JUDGING_ROUNDS}/new`;
      if (parsed.success) {
        const { sourceRoundId, ...choices } = parsed.data;
        const roundSettings = {
          ...choices,
          entrySource:
            sourceRoundId === "verified_entries"
              ? ("verified_entries" as const)
              : ("round_finalists" as const),
          sourceRoundId:
            sourceRoundId === "verified_entries" ? null : sourceRoundId,
        };
        if (operation === "create") {
          const result = await api.createJudgingRound({
            competitionId,
            ...roundSettings,
          });
          if (result.ok) target = adminJudgingRoundPath(result.roundId);
          done = result.ok ? "created" : result.error;
        } else {
          const result = await api.updateJudgingRound({
            roundId,
            ...roundSettings,
          });
          done = result.ok ? "saved" : result.error;
        }
      }
    } else if (operation === "open") {
      const result = await api.openJudgingRound({ roundId });
      done = result.ok ? "opened" : result.error;
    } else if (operation === "lock" || operation === "override-lock") {
      target = `${base}/rankings`;
      const result = await api.lockJudgingRound({
        roundId,
        ...(operation === "override-lock"
          ? { overrideReason: text(form, "overrideReason") }
          : {}),
      });
      done = result.ok ? "locked" : result.error;
    } else if (operation === "tag") {
      target = `${base}/rankings`;
      const [outcome, position] = text(form, "recognition").split(":");
      const parsed = z.enum(ROUND_OUTCOMES).safeParse(outcome);
      if (parsed.success) {
        const result = await api.tagRoundOutcomes({
          roundId,
          tags: [
            {
              entryId: text(form, "entryId"),
              outcome: parsed.data,
              awardPosition: position ? Number(position) : null,
              suitableForAuction: form.get("suitableForAuction") === "on",
            },
          ],
        });
        done = result.ok ? "tagged" : result.error;
      }
    } else if (operation === "cancel") {
      const result = await api.cancelJudgingRound({
        roundId,
        reason: text(form, "reason"),
      });
      done = result.ok ? "cancelled" : result.error;
    } else if (operation === "invite") {
      target = `${base}/judges`;
      const result = await api.inviteJudge({
        roundId,
        email: text(form, "email"),
      });
      done = result.ok ? "invited" : result.error;
    } else if (operation === "revoke") {
      target = `${base}/judges`;
      const result = await api.revokeJudgeInvitation({
        roundId,
        invitationId: text(form, "invitationId"),
      });
      done = result.ok ? "revoked" : result.error;
    } else if (operation === "remove") {
      target = `${base}/judges`;
      const result = await api.removeJudge({
        roundId,
        userId: text(form, "judgeUserId"),
      });
      done = result.ok ? "removed" : result.error;
    } else if (operation === "admit") {
      target = `${base}/pool`;
      const result = await api.admitToPool({ roundId });
      done = result.ok ? "admitted" : result.error;
      if (result.ok)
        counts = {
          count: String(result.admitted),
          refused: String(result.refused.length),
          physical: String(
            result.refused.filter((r) => r.reason === "not_physically_ready")
              .length
          ),
          finalists: String(
            result.refused.filter((r) => r.reason === "not_source_finalist")
              .length
          ),
          verification: String(
            result.refused.filter((r) => r.reason === "not_foa_verified").length
          ),
        };
    } else if (operation === "assign") {
      target = `${base}/assignments`;
      const selected = form
        .getAll("entryIds")
        .filter((id): id is string => typeof id === "string");
      const result = await api.assignEntries({
        roundId,
        judgeUserId: text(form, "judgeUserId"),
        ...(selected.length ? { entryIds: selected } : {}),
      });
      done = result.ok ? "assigned" : result.error;
      if (result.ok)
        counts = {
          count: String(result.assigned),
          conflicts: String(result.conflicted),
          duplicates: String(result.alreadyAssigned),
        };
    } else if (operation === "unassign") {
      target = `${base}/assignments`;
      const result = await api.unassignEntry({
        roundId,
        judgeUserId: text(form, "judgeUserId"),
        entryId: text(form, "entryId"),
      });
      done = result.ok ? "removed" : result.error;
    } else if (operation === "flag") {
      target = `${base}/conflicts`;
      const result = await api.flagConflict({
        roundId,
        judgeUserId: text(form, "judgeUserId"),
        entryId: text(form, "entryId"),
        note: text(form, "note"),
      });
      done = result.ok ? "flagged" : result.error;
    }
  } catch (error) {
    done = error instanceof DomainError ? error.code : "failed";
    if (!(error instanceof DomainError))
      console.error(`Judging action failed: ${errorSummaryForLogs(error)}`);
  }
  redirect(`${target}?${new URLSearchParams({ done, ...counts })}`);
}
