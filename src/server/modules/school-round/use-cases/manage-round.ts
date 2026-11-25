// Competition-manager corrections to a school's own round (#90). All
// writes hold the competition, then the round, then its entries; in
// particular a verifier cannot race a reopen (the verifier holds the
// same round before deciding an entry).
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import {
  competition,
  entry,
  entryFile,
  entryTransition,
  institution,
  institutionRegistration,
  schoolRound,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import type { UseCaseContext } from "../../../use-cases";
import { competitionResource } from "../../competitions/manage";
import { recordMove } from "../../entries/store";
import type { EntryStatus } from "../../entries/domain/status";
import type { FinaliseBlocker } from "../domain/finalise";
import { planReopen, type ReopenBlocker } from "../domain/reopen";
import { applyFinalOutcomes } from "../apply-final-outcomes";
import {
  isSchoolRoundFinished,
  type SchoolRoundStatus,
} from "../domain/status";
import { shortlistDeadlineOf } from "../overdue";
import { loadRoundEntries, recordRoundTransition } from "../store";

const refInput = z.object({ competitionId: z.uuid(), roundId: z.uuid() });
const closeInput = refInput.extend({
  reason: z.string().trim().min(1).max(1000),
});
export type ManageRoundInput = z.input<typeof refInput>;
export type CloseSchoolRoundInput = z.input<typeof closeInput>;

type Refusal =
  | InvalidInput
  | { ok: false; error: "not_found" | "competition_not_judging" };
export type CloseSchoolRoundResult =
  | Refusal
  | { ok: false; error: "round_not_overdue" | "shortlist_only" }
  | { ok: false; error: "finalise_blocked"; blockers: FinaliseBlocker[] }
  | { ok: true; shortlisted: number; notShortlisted: number };
export type ReopenSchoolRoundResult =
  | Refusal
  | { ok: false; error: "reopen_blocked"; blockers: ReopenBlocker[] }
  | { ok: true; status: "open" | "overdue" };

function judging(status: string) {
  return status === "school_judging" || status === "foa_judging";
}

export async function closeSchoolRoundOnBehalf(
  ctx: UseCaseContext,
  input: CloseSchoolRoundInput
): Promise<CloseSchoolRoundResult> {
  const { role } = await authorize(
    ctx,
    "school_round.close_on_behalf",
    competitionResource(input.competitionId)
  );
  const parsed = closeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const userId = ctx.actor.userId;
  const { competitionId, roundId, reason } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const [comp] = await tx
      .select()
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("share");
    const [round] = await tx
      .select()
      .from(schoolRound)
      .where(
        and(
          eq(schoolRound.id, roundId),
          eq(schoolRound.competitionId, competitionId)
        )
      )
      .for("update");
    if (!comp || !round) return { ok: false, error: "not_found" };
    if (!judging(comp.status))
      return { ok: false, error: "competition_not_judging" };
    if (round.status !== "overdue")
      return { ok: false, error: "round_not_overdue" };
    const applied = await applyFinalOutcomes(tx, ctx, {
      roundId,
      institutionRegistrationId: round.institutionRegistrationId,
      shortlistOnly: comp.digitalScope === "shortlist_only",
      role,
      prerequisites: {
        by: "manager",
        panelSize: 0,
        conductCertified: false,
        judgingAttested: false,
      },
    });
    if (!applied.ok) return applied;
    const { shortlisted, notShortlisted } = applied;
    const now = ctx.clock.now();
    await tx
      .update(schoolRound)
      .set({
        status: "closed_on_behalf",
        closedAt: now,
        closedByUserId: userId,
        closeReason: reason,
        updatedAt: now,
      })
      .where(eq(schoolRound.id, roundId));
    await recordRoundTransition(tx, ctx, {
      roundId,
      from: round.status,
      to: "closed_on_behalf",
      reason,
    });
    await recordAudit(tx, ctx, {
      action: "school_round.closed_on_behalf",
      entity: { type: "school_round", id: roundId },
      before: { status: round.status },
      after: {
        status: "closed_on_behalf",
        reason,
        shortlisted,
        notShortlisted,
      },
      actorRole: role,
    });
    await emit(tx, ctx.clock, {
      type: "school_round.closed_on_behalf",
      aggregate: { type: "school_round", id: roundId },
      payload: {
        roundId,
        competitionId,
        institutionRegistrationId: round.institutionRegistrationId,
      },
    });
    return { ok: true, shortlisted, notShortlisted };
  });
}

export async function reopenSchoolRound(
  ctx: UseCaseContext,
  input: ManageRoundInput
): Promise<ReopenSchoolRoundResult> {
  const { role } = await authorize(
    ctx,
    "school_round.reopen",
    competitionResource(input.competitionId)
  );
  const parsed = refInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, roundId } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const [comp] = await tx
      .select()
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("share");
    const [round] = await tx
      .select()
      .from(schoolRound)
      .where(
        and(
          eq(schoolRound.id, roundId),
          eq(schoolRound.competitionId, competitionId)
        )
      )
      .for("update");
    if (!comp || !round) return { ok: false, error: "not_found" };
    const entries = await loadRoundEntries(
      tx,
      round.institutionRegistrationId,
      { lock: true }
    );
    const ids = entries.map((e) => e.entryId);
    const history = ids.length
      ? await tx
          .select()
          .from(entryTransition)
          .where(inArray(entryTransition.entryId, ids))
          .orderBy(desc(entryTransition.sequence))
      : [];
    const files = ids.length
      ? await tx
          .select({
            entryId: entryFile.entryId,
            becameLiveAt: entryFile.becameLiveAt,
            status: entryFile.status,
          })
          .from(entryFile)
          .where(inArray(entryFile.entryId, ids))
          .orderBy(desc(entryFile.createdAt))
      : [];
    const live = new Map(
      files
        .filter((file) => file.status === "live")
        .map((file) => [file.entryId, file.becameLiveAt])
    );
    const latest = new Map<string, (typeof files)[number]>();
    for (const file of files)
      if (!latest.has(file.entryId)) latest.set(file.entryId, file);
    const before = new Map<string, EntryStatus>();
    const verified = new Set<string>();
    for (const move of history) {
      if (move.toStatus === "foa_verified") verified.add(move.entryId);
      if (
        !before.has(move.entryId) &&
        (move.trigger === "school_shortlisted" ||
          move.trigger === "not_shortlisted") &&
        move.fromStatus
      )
        before.set(move.entryId, move.fromStatus);
    }
    const plan = planReopen({
      competitionInJudging: comp.status === "school_judging",
      roundStatus: round.status,
      shortlistDeadline: await shortlistDeadlineOf(tx, competitionId),
      now: ctx.clock.now(),
      entries: entries.map((e) => {
        let previous =
          comp.digitalScope === "shortlist_only"
            ? ("school_shortlisted" as const)
            : (before.get(e.entryId) ?? e.status);
        const last = latest.get(e.entryId);
        if (
          previous === "processing" &&
          (last?.status === "failed" || last?.status === "rejected")
        )
          previous = last.status;
        return {
          entryId: e.entryId,
          status: verified.has(e.entryId) ? "foa_verified" : e.status,
          statusBefore: previous,
          hasLiveFile: live.has(e.entryId),
        };
      }),
    });
    if (!plan.ok)
      return { ok: false, error: "reopen_blocked", blockers: plan.blockers };
    const now = ctx.clock.now();
    for (const move of plan.reverts) {
      await recordMove(tx, ctx, {
        ...move,
        trigger: "school_round_reopened",
        entryFileId: null,
        actorRole: role,
      });
      await tx
        .update(entry)
        .set({
          status: move.to,
          ...(move.to === "submitted" && live.get(move.entryId)
            ? {
                submittedAt: sql`coalesce(${entry.submittedAt}, ${live.get(move.entryId)!.toISOString()}::timestamptz)`,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(entry.id, move.entryId));
    }
    await tx
      .update(schoolRound)
      .set({
        status: plan.roundStatus,
        judgingAttestedByUserId: null,
        judgingAttestedAt: null,
        judgingStatementVersion: null,
        finalisedByUserId: null,
        finalisedAt: null,
        closedByUserId: null,
        closedAt: null,
        closeReason: null,
        familiesNotifiedAt: null,
        updatedAt: now,
      })
      .where(eq(schoolRound.id, roundId));
    await recordRoundTransition(tx, ctx, {
      roundId,
      from: round.status,
      to: plan.roundStatus,
    });
    await recordAudit(tx, ctx, {
      action: "school_round.reopened",
      entity: { type: "school_round", id: roundId },
      before: { status: round.status },
      after: { status: plan.roundStatus, reverted: plan.reverts.length },
      actorRole: role,
    });
    return { ok: true, status: plan.roundStatus };
  });
}

export type ManagerRound = {
  id: string;
  institutionName: string;
  reference: string;
  status: SchoolRoundStatus;
  canClose: boolean;
  canReopen: boolean;
  closeReason: string | null;
};
export async function listSchoolRoundsForManager(
  ctx: UseCaseContext,
  input: { competitionId: string }
): Promise<
  { ok: true; competitionName: string; rounds: ManagerRound[] } | Refusal
> {
  await authorize(
    ctx,
    "school_round.manager_read",
    competitionResource(input.competitionId)
  );
  const parsed = refInput.pick({ competitionId: true }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [comp] = await ctx.db
    .select()
    .from(competition)
    .where(eq(competition.id, input.competitionId));
  if (!comp) return { ok: false, error: "not_found" };
  const rows = await ctx.db
    .select({
      id: schoolRound.id,
      institutionName: institution.name,
      reference: institutionRegistration.reference,
      status: schoolRound.status,
      closeReason: schoolRound.closeReason,
    })
    .from(schoolRound)
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, schoolRound.institutionRegistrationId)
    )
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .where(eq(schoolRound.competitionId, comp.id))
    .orderBy(institution.name);
  return {
    ok: true,
    competitionName: comp.name,
    rounds: rows.map((row) => ({
      ...row,
      canClose: judging(comp.status) && row.status === "overdue",
      canReopen:
        comp.status === "school_judging" && isSchoolRoundFinished(row.status),
    })),
  };
}
