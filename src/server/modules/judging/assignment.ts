// The staff-only pool and assignments; all mutations of a round serialise
// on its row. The composite FK prevents an assignment outside its pool.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../../audit/record";
import {
  entry,
  judgeConflict,
  judgeOnboarding,
  registration,
  roundAssignment,
  roundEntry,
  user,
  userRole,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { decideAssignment, type AssignmentRefusal } from "./domain/assignment";
import { isConflicted } from "./domain/conflicts";
import { decidePoolAdmission, type PoolRefusal } from "./domain/pool-admission";
import { acceptsJudges } from "./domain/round-status";
import {
  loadEntryConflictFacts,
  loadJudgeConflictFacts,
} from "./conflict-facts";
import { loadJudgeReadiness } from "./judges";
import { actorId, authorizeRound, loadRound } from "./rounds";
import { physicallyReadyEntryIds } from "./physical-readiness";

const notFound = { ok: false, error: "not_found" } as const;
const closed = { ok: false, error: "round_closed" } as const;
const poolInput = z.object({
  roundId: z.uuid(),
  entryIds: z.array(z.uuid()).max(5000).optional(),
});
const assignInput = poolInput.extend({ judgeUserId: z.uuid() });
const onePairInput = z.object({
  roundId: z.uuid(),
  judgeUserId: z.uuid(),
  entryId: z.uuid(),
});
const flagInput = onePairInput.extend({
  note: z.string().trim().max(1000).optional(),
});
const assignmentPair = (i: z.infer<typeof onePairInput>) =>
  and(
    eq(roundAssignment.roundId, i.roundId),
    eq(roundAssignment.judgeUserId, i.judgeUserId),
    eq(roundAssignment.entryId, i.entryId)
  );
export async function admitToPool(
  ctx: UseCaseContext,
  input: z.input<typeof poolInput>
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  const parsed = poolInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    const requested =
      parsed.data.entryIds === undefined
        ? undefined
        : [...new Set(parsed.data.entryIds)];
    const entries =
      requested?.length === 0
        ? []
        : await tx
            .select({ id: entry.id, status: entry.status })
            .from(entry)
            .where(
              and(
                eq(entry.competitionId, round.competitionId),
                requested ? inArray(entry.id, requested) : undefined
              )
            )
            .for("share");
    const statuses = new Map(entries.map((e) => [e.id, e.status]));
    const physicallyReady = current.judgesPhysical
      ? await physicallyReadyEntryIds(tx, round.competitionId)
      : new Set<string>();
    const refused: { entryId: string; reason: PoolRefusal }[] = [];
    const admittedIds: string[] = [];
    for (const entryId of requested ?? entries.map((e) => e.id)) {
      const decision = decidePoolAdmission({
        judgesPhysical: current.judgesPhysical,
        foaVerified: statuses.get(entryId) === "foa_verified",
        physicallyReady: physicallyReady.has(entryId),
      });
      if (decision.admitted) admittedIds.push(entryId);
      else refused.push({ entryId, reason: decision.reason });
    }
    const now = ctx.clock.now();
    const inserted = admittedIds.length
      ? await tx
          .insert(roundEntry)
          .values(
            admittedIds.map((entryId) => ({
              roundId: round.id,
              entryId,
              admittedByUserId: actorId(ctx),
              admittedAt: now,
            }))
          )
          .onConflictDoNothing()
          .returning({ entryId: roundEntry.entryId })
      : [];
    if (inserted.length)
      await recordAudit(tx, ctx, {
        action: "judging.pool_admitted",
        entity: { type: "judging_round", id: round.id },
        before: null,
        after: { entryIds: inserted.map((r) => r.entryId) },
        actorRole: role,
      });
    return {
      ok: true,
      admitted: inserted.length,
      alreadyAdmitted: admittedIds.length - inserted.length,
      refused,
    } as const;
  });
}
export async function assignEntries(
  ctx: UseCaseContext,
  input: z.input<typeof assignInput>
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  const parsed = assignInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  const judgeUserId = parsed.data.judgeUserId;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, judgeUserId))
      .for("no key update");
    if (
      !(await loadJudgeReadiness(tx, { roundId: round.id, judgeUserId })).ready
    )
      return { ok: false, error: "judge_not_ready" } as const;
    const pool = await tx
      .select({ entryId: roundEntry.entryId })
      .from(roundEntry)
      .where(eq(roundEntry.roundId, round.id));
    const poolIds = new Set(pool.map((p) => p.entryId));
    const existing = await tx
      .select({ entryId: roundAssignment.entryId })
      .from(roundAssignment)
      .where(
        and(
          eq(roundAssignment.roundId, round.id),
          eq(roundAssignment.judgeUserId, judgeUserId)
        )
      );
    const assigned = new Set(existing.map((a) => a.entryId));
    const requested =
      parsed.data.entryIds === undefined
        ? [...poolIds]
        : [...new Set(parsed.data.entryIds)];
    const judgeFacts = await loadJudgeConflictFacts(tx, {
      roundId: round.id,
      judgeUserId,
    });
    const facts = new Map(
      (
        await loadEntryConflictFacts(
          tx,
          requested.filter((id) => poolIds.has(id))
        )
      ).map((e) => [e.entryId, e])
    );
    const allowed: string[] = [];
    const refused: { entryId: string; reason: AssignmentRefusal }[] = [];
    for (const entryId of requested) {
      const entryFacts = facts.get(entryId);
      const decision = decideAssignment({
        roundAcceptsJudges: true,
        judgeReady: true,
        inPool: poolIds.has(entryId),
        conflicted: entryFacts ? isConflicted(judgeFacts, entryFacts) : false,
        alreadyAssigned: assigned.has(entryId),
      });
      if (decision.ok) allowed.push(entryId);
      else refused.push({ entryId, reason: decision.reason });
    }
    const now = ctx.clock.now();
    const inserted = allowed.length
      ? await tx
          .insert(roundAssignment)
          .values(
            allowed.map((entryId) => ({
              roundId: round.id,
              judgeUserId,
              entryId,
              assignedByUserId: actorId(ctx),
              assignedAt: now,
            }))
          )
          .onConflictDoNothing()
          .returning({ entryId: roundAssignment.entryId })
      : [];
    if (inserted.length)
      await recordAudit(tx, ctx, {
        action: "judging.entries_assigned",
        entity: { type: "judging_round", id: round.id },
        before: null,
        after: { judgeUserId, entryIds: inserted.map((i) => i.entryId) },
        actorRole: role,
      });
    return {
      ok: true,
      assigned: inserted.length,
      conflicted: refused.filter((r) => r.reason === "conflict").length,
      alreadyAssigned: refused.filter((r) => r.reason === "already_assigned")
        .length,
      refused: parsed.data.entryIds === undefined ? [] : refused,
    } as const;
  });
}
export async function unassignEntry(
  ctx: UseCaseContext,
  input: z.input<typeof onePairInput>
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  const parsed = onePairInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    const deleted = await tx
      .delete(roundAssignment)
      .where(assignmentPair(parsed.data))
      .returning({ entryId: roundAssignment.entryId });
    if (deleted.length)
      await recordAudit(tx, ctx, {
        action: "judging.entry_unassigned",
        entity: { type: "judging_round", id: round.id },
        before: { judgeUserId: input.judgeUserId, entryId: input.entryId },
        after: null,
        actorRole: role,
      });
    return { ok: true } as const;
  });
}
export async function flagConflict(
  ctx: UseCaseContext,
  input: z.input<typeof flagInput>
) {
  const { round, role } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.manage"
  );
  const parsed = flagInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!round) return notFound;
  return ctx.db.transaction(async (tx) => {
    const current = await loadRound(tx, round.id, true);
    if (!current || !acceptsJudges(current.status)) return closed;
    const [target] = await tx
      .select({ id: entry.id })
      .from(entry)
      .where(
        and(
          eq(entry.competitionId, round.competitionId),
          eq(entry.id, input.entryId)
        )
      );
    const [judge] = await tx
      .select({ id: userRole.id })
      .from(userRole)
      .where(
        and(
          eq(userRole.userId, input.judgeUserId),
          eq(userRole.role, "judge"),
          eq(userRole.scopeType, "round"),
          eq(userRole.scopeId, round.id)
        )
      );
    if (!target || !judge) return notFound;
    const now = ctx.clock.now();
    const [flag] = await tx
      .insert(judgeConflict)
      .values({
        id: uuidv7(now),
        roundId: round.id,
        judgeUserId: input.judgeUserId,
        entryId: input.entryId,
        source: "staff",
        note: parsed.data.note || null,
        createdAt: now,
        createdByUserId: actorId(ctx),
      })
      .onConflictDoNothing()
      .returning({ id: judgeConflict.id });
    const removed = await tx
      .delete(roundAssignment)
      .where(assignmentPair(parsed.data))
      .returning({ entryId: roundAssignment.entryId });
    if (flag || removed.length)
      await recordAudit(tx, ctx, {
        action: "judging.conflict_flagged",
        entity: { type: "judging_round", id: round.id },
        before: null,
        after: {
          judgeUserId: input.judgeUserId,
          entryId: input.entryId,
          assignmentRemoved: removed.length > 0,
        },
        actorRole: role,
      });
    return { ok: true } as const;
  });
}
export async function getRoundPool(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const { round } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.read"
  );
  if (!round) return notFound;
  const entries = await ctx.db
    .select({
      entryId: roundEntry.entryId,
      code: entry.code,
      discipline: entry.discipline,
      categoryId: registration.ageGroupId,
      admittedAt: roundEntry.admittedAt,
    })
    .from(roundEntry)
    .innerJoin(entry, eq(entry.id, roundEntry.entryId))
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .where(eq(roundEntry.roundId, round.id));
  const assignments = await ctx.db
    .select({ entryId: roundAssignment.entryId })
    .from(roundAssignment)
    .where(eq(roundAssignment.roundId, round.id));
  const counts = new Map<string, number>();
  for (const a of assignments)
    counts.set(a.entryId, (counts.get(a.entryId) ?? 0) + 1);
  return {
    ok: true,
    entries: entries.map((e) => ({
      ...e,
      assignmentCount: counts.get(e.entryId) ?? 0,
    })),
  } as const;
}
export async function listAssignments(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const { round } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.read"
  );
  if (!round) return notFound;
  const assignments = await ctx.db
    .select({
      judgeUserId: roundAssignment.judgeUserId,
      judgeName: user.name,
      entryId: roundAssignment.entryId,
      code: entry.code,
      discipline: entry.discipline,
      categoryId: registration.ageGroupId,
      assignedAt: roundAssignment.assignedAt,
    })
    .from(roundAssignment)
    .innerJoin(entry, eq(entry.id, roundAssignment.entryId))
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .innerJoin(user, eq(user.id, roundAssignment.judgeUserId))
    .where(eq(roundAssignment.roundId, round.id));
  return { ok: true, assignments } as const;
}
export async function listRoundConflicts(
  ctx: UseCaseContext,
  input: { roundId: string }
) {
  const { round } = await authorizeRound(
    ctx,
    input.roundId,
    "judging.round.read"
  );
  if (!round) return notFound;
  const declarations = await ctx.db
    .select({
      judgeUserId: judgeOnboarding.judgeUserId,
      judgeName: user.name,
      statement: judgeOnboarding.conflictStatement,
      none: judgeOnboarding.conflictsNone,
      declaredAt: judgeOnboarding.conflictsDeclaredAt,
    })
    .from(judgeOnboarding)
    .innerJoin(user, eq(user.id, judgeOnboarding.judgeUserId))
    .where(eq(judgeOnboarding.roundId, round.id));
  const conflicts = await ctx.db
    .select()
    .from(judgeConflict)
    .where(eq(judgeConflict.roundId, round.id));
  return { ok: true, declarations, conflicts } as const;
}
export const assignmentUseCases = (ctx: UseCaseContext) => ({
  admitToPool: (input: z.input<typeof poolInput>) => admitToPool(ctx, input),
  assignEntries: (input: z.input<typeof assignInput>) =>
    assignEntries(ctx, input),
  unassignEntry: (input: z.input<typeof onePairInput>) =>
    unassignEntry(ctx, input),
  flagConflict: (input: z.input<typeof flagInput>) => flagConflict(ctx, input),
  getRoundPool: (input: { roundId: string }) => getRoundPool(ctx, input),
  listAssignments: (input: { roundId: string }) => listAssignments(ctx, input),
  listRoundConflicts: (input: { roundId: string }) =>
    listRoundConflicts(ctx, input),
});
