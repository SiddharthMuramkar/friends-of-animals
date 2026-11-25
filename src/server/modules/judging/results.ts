// Live rankings and the only transition that freezes them. The round row
// serializes score saves, assignment changes, locking and recognition tags.
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competitionAgeGroup,
  criterionScore,
  entry,
  registration,
  roundAssignment,
  roundEntry,
  roundResult,
  judgingRound,
  scoreSheet,
  user,
  type JudgingRound,
  type RoundResult,
} from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { pinnedCriteria } from "./blind/queries";
import { conflictedEntryIds } from "./conflict-facts";
import { loadJudgeReadiness } from "./judges";
import { physicallyReadyEntryIds } from "./physical-readiness";
import {
  actorId,
  authorizeRound,
  competitionScope,
  loadRound,
  roundIdInput,
} from "./rounds";
import { decideRoundLock, roundAllows } from "./domain/round-lock";
import {
  isSheetComplete,
  rankEntries,
  TIE_BREAK_RULE,
  type RankingEntry,
  type ScoreSheet,
} from "./domain/ranking";
import {
  outcomeTagProblems,
  prefillOutcomes,
  ROUND_OUTCOMES,
  type OutcomeTag,
} from "./domain/outcomes";

const notFound = { ok: false, error: "not_found" } as const;
const closed = { ok: false, error: "round_closed" } as const;
const lockInput = roundIdInput.extend({
  overrideReason: z.string().optional(),
});
const tagsInput = roundIdInput.extend({
  tags: z
    .array(
      z.strictObject({
        entryId: z.uuid(),
        outcome: z.enum(ROUND_OUTCOMES),
        awardPosition: z.int().nullable(),
        suitableForAuction: z.boolean(),
      })
    )
    .max(5000),
});

async function visiblePool(db: AppDb, round: JudgingRound) {
  const physical = round.judgesPhysical
    ? await physicallyReadyEntryIds(db, round.competitionId)
    : null;
  const rows = await db
    .select({
      entryId: entry.id,
      code: entry.code,
      discipline: entry.discipline,
      categoryId: registration.ageGroupId,
    })
    .from(roundEntry)
    .innerJoin(entry, eq(entry.id, roundEntry.entryId))
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .where(
      and(eq(roundEntry.roundId, round.id), eq(entry.status, "foa_verified"))
    )
    .orderBy(asc(entry.code));
  return rows.filter((r) => !physical || physical.has(r.entryId));
}

type PoolRow = Awaited<ReturnType<typeof visiblePool>>[number];
function sortedRows(rows: RoundResult[]) {
  return rows.sort(
    (a, b) =>
      a.discipline.localeCompare(b.discipline) ||
      a.categoryId.localeCompare(b.categoryId) ||
      a.rank - b.rank ||
      a.entryId.localeCompare(b.entryId)
  );
}

async function calculateRankings(db: AppDb, round: JudgingRound) {
  const pool = await visiblePool(db, round);
  const entries = new Map(
    pool.map((e) => [e.entryId, { ...e, sheets: [] as ScoreSheet[] }])
  );
  const assignments = await db
    .select({
      entryId: roundAssignment.entryId,
      judgeUserId: roundAssignment.judgeUserId,
      sheetId: scoreSheet.id,
      complete: scoreSheet.complete,
    })
    .from(roundAssignment)
    .leftJoin(
      scoreSheet,
      and(
        eq(scoreSheet.roundId, roundAssignment.roundId),
        eq(scoreSheet.entryId, roundAssignment.entryId),
        eq(scoreSheet.judgeUserId, roundAssignment.judgeUserId)
      )
    )
    .where(eq(roundAssignment.roundId, round.id));
  const judgeIds = [...new Set(assignments.map((a) => a.judgeUserId))].sort();
  // The access module takes user row locks when roles change. Current
  // assignments and declarations themselves are protected by the round lock.
  if (judgeIds.length)
    await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, judgeIds))
      .orderBy(asc(user.id))
      .for("no key update");
  const allowed = new Map<string, Set<string> | null>();
  for (const judgeUserId of judgeIds) {
    const readiness = await loadJudgeReadiness(db, {
      roundId: round.id,
      judgeUserId,
    });
    allowed.set(
      judgeUserId,
      readiness.ready
        ? await conflictedEntryIds(db, round.id, judgeUserId)
        : null
    );
  }
  const criteria = new Map<
    PoolRow["discipline"],
    Awaited<ReturnType<typeof pinnedCriteria>>
  >();
  for (const discipline of new Set(pool.map((e) => e.discipline)))
    criteria.set(discipline, await pinnedCriteria(db, round.id, discipline));
  const eligible = assignments.filter((a) => {
    const conflicts = allowed.get(a.judgeUserId);
    return (
      entries.has(a.entryId) &&
      conflicts &&
      !conflicts.has(a.entryId) &&
      a.complete &&
      a.sheetId
    );
  });
  const scores = eligible.length
    ? await db
        .select()
        .from(criterionScore)
        .where(
          inArray(
            criterionScore.scoreSheetId,
            eligible.map((a) => a.sheetId!)
          )
        )
    : [];
  const bySheet = new Map<string, Record<string, number | undefined>>();
  for (const score of scores) {
    const fields = bySheet.get(score.scoreSheetId) ?? {};
    fields[score.criterionId] = score.value ?? undefined;
    bySheet.set(score.scoreSheetId, fields);
  }
  const completed = new Set<string>();
  const assignmentId = (a: { entryId: string; judgeUserId: string }) =>
    `${a.entryId}/${a.judgeUserId}`;
  for (const a of eligible) {
    const item = entries.get(a.entryId)!;
    const sheet = {
      judgeId: a.judgeUserId,
      scores: bySheet.get(a.sheetId!) ?? {},
    };
    const pinned = criteria.get(item.discipline)!;
    if (!pinned.length || !isSheetComplete(pinned, sheet)) continue;
    item.sheets.push(sheet);
    completed.add(assignmentId(a));
  }
  const partitions = new Map<string, (PoolRow & RankingEntry)[]>();
  for (const item of entries.values()) {
    const key = `${item.discipline}/${item.categoryId}`;
    const partition = partitions.get(key) ?? [];
    partition.push(item);
    partitions.set(key, partition);
  }
  const ranked: RoundResult[] = [];
  const unscored: PoolRow[] = [];
  for (const partition of partitions.values()) {
    const pinned = criteria.get(partition[0]!.discipline)!;
    if (!pinned.length) {
      unscored.push(...partition.map(({ sheets: _, ...row }) => row));
      continue;
    }
    const result = rankEntries(pinned, partition);
    for (const r of result.ranked) {
      const { sheets: _, ...item } = entries.get(r.entryId)!;
      ranked.push({
        ...item,
        roundId: round.id,
        rank: r.rank,
        scoreNumerator: r.score.num.toString(),
        scoreDenominator: r.score.den.toString(),
        sheetsCounted: r.sheetsCounted,
        decidedBy: r.decidedBy,
        outcome: "none",
        awardPosition: null,
        suitableForAuction: false,
      });
    }
    for (const id of result.unscored) {
      const { sheets: _, ...item } = entries.get(id)!;
      unscored.push(item);
    }
  }
  return {
    ranked: sortedRows(ranked),
    unscored,
    assignments: assignments.map((a) => ({
      assignmentId: assignmentId(a),
      scored: completed.has(assignmentId(a)),
    })),
  };
}

async function getRoundRankings(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const { round } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.read"
  );
  if (!round) return notFound;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current) return notFound;
    if (!roundAllows(current.status, "viewRankings")) return closed;
    const groups = await tx
      .select({ id: competitionAgeGroup.id, label: competitionAgeGroup.label })
      .from(competitionAgeGroup)
      .where(eq(competitionAgeGroup.competitionId, current.competitionId));
    const categoryLabels = Object.fromEntries(
      groups.map((g) => [g.id, g.label])
    );
    if (current.status === "locked") {
      const pool = await visiblePool(tx, current);
      const visible = new Set(pool.map((p) => p.entryId));
      const snapshot = await tx
        .select()
        .from(roundResult)
        .where(eq(roundResult.roundId, round.id));
      const ranked = sortedRows(snapshot.filter((r) => visible.has(r.entryId)));
      const rankedIds = new Set(snapshot.map((r) => r.entryId));
      return {
        ok: true,
        round: current,
        categoryLabels,
        ranked,
        unscored: pool.filter((r) => !rankedIds.has(r.entryId)),
        assignedCount: null,
        unscoredCount: null,
        tieBreakRule: current.tieBreakRule ?? TIE_BREAK_RULE,
      } as const;
    }
    const { ranked, unscored, assignments } = await calculateRankings(
      tx,
      current
    );
    return {
      ok: true,
      round: current,
      categoryLabels,
      ranked,
      unscored,
      assignedCount: assignments.length,
      unscoredCount: assignments.filter((a) => !a.scored).length,
      tieBreakRule: TIE_BREAK_RULE,
    } as const;
  });
}

async function lockJudgingRound(
  ctx: UseCaseContext,
  input: z.input<typeof lockInput>
) {
  const action =
    input.overrideReason === undefined
      ? "judging.round.lock"
      : "judging.round.override";
  const { round } = await authorizeRound(ctx, input.roundId, action);
  const parsed = lockInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current) return notFound;
    const { role } = await authorize(
      { ...ctx, db: tx },
      action,
      competitionScope(current.competitionId)
    );
    if (current.status !== "open")
      return { ok: false, error: "round_not_open" } as const;
    const { ranked, assignments } = await calculateRankings(tx, current);
    const decision = decideRoundLock({
      status: current.status,
      assignments,
      override:
        parsed.data.overrideReason === undefined
          ? undefined
          : { reason: parsed.data.overrideReason },
    });
    if (!decision.ok) return { ...decision, error: decision.code };
    const tags = new Map(
      prefillOutcomes(current.awardScheme, ranked).map((t) => [t.entryId, t])
    );
    if (ranked.length)
      await tx
        .insert(roundResult)
        .values(ranked.map((r) => ({ ...r, ...tags.get(r.entryId)! })));
    const now = ctx.clock.now();
    await tx
      .update(judgingRound)
      .set({
        status: "locked",
        lockedAt: now,
        lockedByUserId: actorId(ctx),
        tieBreakRule: TIE_BREAK_RULE,
        lockOverrideReason:
          decision.mode === "override" ? decision.reason : null,
        updatedAt: now,
      })
      .where(eq(judgingRound.id, current.id));
    await recordAudit(tx, ctx, {
      action:
        decision.mode === "override"
          ? "judging_round.lock_overridden"
          : "judging_round.locked",
      entity: { type: "judging_round", id: current.id },
      before: { status: "open" },
      after: {
        status: "locked",
        tieBreakRule: TIE_BREAK_RULE,
        rankedCount: ranked.length,
        assignedCount: assignments.length,
        ...(decision.mode === "override"
          ? {
              reason: decision.reason,
              unscoredAssignmentIds: decision.unscoredAssignmentIds,
            }
          : {}),
      },
      actorRole: role,
    });
    return {
      ok: true,
      mode: decision.mode,
      rankedCount: ranked.length,
    } as const;
  });
}

async function tagRoundOutcomes(
  ctx: UseCaseContext,
  input: z.input<typeof tagsInput>
) {
  const { round } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.tag"
  );
  const parsed = tagsInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current) return notFound;
    const { role } = await authorize(
      { ...ctx, db: tx },
      "judging.round.tag",
      competitionScope(current.competitionId)
    );
    if (!roundAllows(current.status, "tagOutcomes"))
      return { ok: false, error: "round_not_locked" } as const;
    const pool = await visiblePool(tx, current);
    const visible = new Set(pool.map((p) => p.entryId));
    const rows = await tx
      .select()
      .from(roundResult)
      .where(eq(roundResult.roundId, round.id));
    const allowed = rows.filter((r) => visible.has(r.entryId));
    const problems = outcomeTagProblems(
      current.awardScheme,
      allowed.map((r) => r.entryId),
      parsed.data.tags
    );
    if (problems.length)
      return { ok: false, error: "invalid_outcomes", problems } as const;
    const before: OutcomeTag[] = [];
    const after: OutcomeTag[] = [];
    for (const tag of parsed.data.tags) {
      const prior = allowed.find((r) => r.entryId === tag.entryId)!;
      if (
        prior.outcome === tag.outcome &&
        prior.awardPosition === tag.awardPosition &&
        prior.suitableForAuction === tag.suitableForAuction
      )
        continue;
      before.push({
        entryId: prior.entryId,
        outcome: prior.outcome,
        awardPosition: prior.awardPosition,
        suitableForAuction: prior.suitableForAuction,
      });
      after.push(tag);
      await tx
        .update(roundResult)
        .set({
          outcome: tag.outcome,
          awardPosition: tag.awardPosition,
          suitableForAuction: tag.suitableForAuction,
        })
        .where(
          and(
            eq(roundResult.roundId, round.id),
            eq(roundResult.entryId, tag.entryId)
          )
        );
    }
    if (after.length)
      await recordAudit(tx, ctx, {
        action: "judging_round.outcomes_tagged",
        entity: { type: "judging_round", id: round.id },
        before,
        after,
        actorRole: role,
      });
    return { ok: true, changed: after.length } as const;
  });
}

export const roundResultUseCases = (ctx: UseCaseContext) => ({
  getRoundRankings: (input: { roundId: string }) =>
    getRoundRankings(ctx, input),
  lockJudgingRound: (input: z.input<typeof lockInput>) =>
    lockJudgingRound(ctx, input),
  tagRoundOutcomes: (input: z.input<typeof tagsInput>) =>
    tagRoundOutcomes(ctx, input),
});
