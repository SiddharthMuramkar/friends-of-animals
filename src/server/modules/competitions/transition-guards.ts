// The guards on the competition status machine (#88), and the one place
// the schedule's moves are made through them.
//
// A scheduled move whose guard finds something in the way is refused: the
// competition stays where it is, one open competition_transition_block
// row records why, the system's audit entry says so, and a
// `competition.transition_blocked` event tells its competition managers.
// All of that happens once; a later refusal of the same move only brings
// the row's details up to date. The next attempt that passes makes the
// move and resolves the row. Attempts come from the status jobs and from
// each guard's `retryOn` events (retryBlockedMoves in ./advance-status.ts).
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, isNull } from "drizzle-orm";

import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { competition, competitionTransitionBlock } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import { schoolJudgingNeedsPublishedRubrics } from "../judging/guards";
import type { ScheduledTransition } from "./domain/status-schedule";
import { transitionCause } from "./domain/status-machine";
import type {
  CompetitionTransitionGuard,
  GuardedCompetition,
  TransitionBlock,
} from "./domain/transition-block";
import type { CompetitionStatus } from "./domain/vocabulary";

/** Every guard, whatever move it is on. A later ticket adds its line. */
export const TRANSITION_GUARDS: readonly CompetitionTransitionGuard[] = [
  schoolJudgingNeedsPublishedRubrics,
];

for (const guard of TRANSITION_GUARDS) {
  if (transitionCause(guard.from, guard.to) === null) {
    throw new Error(
      `A guard is on ${guard.from} -> ${guard.to}, which the status machine never allows`
    );
  }
}

/** What stops `from` -> `to` for `guarded` now, or null if nothing does. */
async function blockOf(
  db: AppDb,
  guarded: GuardedCompetition,
  from: CompetitionStatus,
  to: CompetitionStatus
): Promise<TransitionBlock | null> {
  for (const guard of TRANSITION_GUARDS) {
    if (guard.from !== from || guard.to !== to) continue;
    const block = await guard.check(db, guarded);
    if (block) return block;
  }
  return null;
}

type MoveContext = { clock: Clock; actor: Actor };

async function openBlock(
  tx: AppDb,
  competitionId: string,
  to: CompetitionStatus
) {
  const [row] = await tx
    .select()
    .from(competitionTransitionBlock)
    .where(
      and(
        eq(competitionTransitionBlock.competitionId, competitionId),
        eq(competitionTransitionBlock.toStatus, to),
        isNull(competitionTransitionBlock.resolvedAt)
      )
    );
  return row ?? null;
}

/** Whether a move of the competition is refused right now. */
export async function hasRefusedMove(
  db: AppDb,
  competitionId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: competitionTransitionBlock.id })
    .from(competitionTransitionBlock)
    .where(
      and(
        eq(competitionTransitionBlock.competitionId, competitionId),
        isNull(competitionTransitionBlock.resolvedAt)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Records a refused move once; later refusals refresh its details. */
async function recordRefusal(
  tx: AppDb,
  ctx: MoveContext,
  competitionId: string,
  move: ScheduledTransition,
  block: TransitionBlock
): Promise<void> {
  const { reason, ...details } = block;
  const now = ctx.clock.now();
  const existing = await openBlock(tx, competitionId, move.to);
  if (existing) {
    await tx
      .update(competitionTransitionBlock)
      .set({ reason, details })
      .where(eq(competitionTransitionBlock.id, existing.id));
    return;
  }
  const id = uuidv7(now);
  await tx.insert(competitionTransitionBlock).values({
    id,
    competitionId,
    fromStatus: move.from,
    toStatus: move.to,
    reason,
    details,
    blockedAt: now,
  });
  await recordAudit(tx, ctx, {
    action: "competition.transition_blocked",
    entity: { type: "competition", id: competitionId },
    before: { status: move.from },
    after: { to: move.to, ...block },
    actorRole: null,
  });
  await emit(tx, ctx.clock, {
    type: "competition.transition_blocked",
    aggregate: { type: "competition", id: competitionId },
    payload: { competitionId, blockId: id },
  });
}

/**
 * Makes `transitions` in order, as far as the guards allow, and returns
 * the status the competition ends in. The caller holds the competition's
 * row locked. Each move made gets one audit entry naming the key date
 * that made it; the first refused move stops the rest.
 */
export async function makeScheduledMoves(
  tx: AppDb,
  ctx: MoveContext,
  guarded: GuardedCompetition,
  transitions: readonly ScheduledTransition[]
): Promise<CompetitionStatus> {
  const now = ctx.clock.now();
  const made: ScheduledTransition[] = [];
  for (const move of transitions) {
    const block = await blockOf(tx, guarded, move.from, move.to);
    if (block) {
      await recordRefusal(tx, ctx, guarded.id, move, block);
      break;
    }
    await tx
      .update(competitionTransitionBlock)
      .set({ resolvedAt: now })
      .where(
        and(
          eq(competitionTransitionBlock.competitionId, guarded.id),
          eq(competitionTransitionBlock.toStatus, move.to),
          isNull(competitionTransitionBlock.resolvedAt)
        )
      );
    made.push(move);
  }
  const last = made.at(-1);
  if (!last) return guarded.status;
  await tx
    .update(competition)
    .set({ status: last.to, updatedAt: now })
    .where(eq(competition.id, guarded.id));
  for (const move of made) {
    await recordAudit(tx, ctx, {
      action: "competition.status_changed",
      entity: { type: "competition", id: guarded.id },
      before: { status: move.from },
      after: {
        status: move.to,
        keyDate: move.keyDate,
        at: move.at.toISOString(),
      },
      actorRole: null,
    });
  }
  // Its school rounds open (#89).
  if (made.some((move) => move.to === "school_judging")) {
    await emit(tx, ctx.clock, {
      type: "competition.school_judging_started",
      aggregate: { type: "competition", id: guarded.id },
      payload: { competitionId: guarded.id },
    });
  }
  return last.to;
}
