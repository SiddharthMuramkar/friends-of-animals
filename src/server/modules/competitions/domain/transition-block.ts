// Why the schedule refused to move a competition (#88). Each guard on the
// status machine (../transition-guards.ts) refuses with one reason here
// and the details that go with it; the refusal is stored as a
// competition_transition_block row and named in the managers' notice.
// #90 added `school_rounds_unfinished`.
//
// Plain TypeScript and zod, no I/O: loads under plain Node (the worker).

import { z } from "zod";

import type { AppDb } from "../../../db/app-db";
import type { EventType } from "../../../outbox/events";
import {
  DISCIPLINES,
  type CompetitionStatus,
  type Discipline,
} from "./vocabulary";

export const TRANSITION_BLOCK = z.discriminatedUnion("reason", [
  z.object({
    /** These enabled disciplines have no published rubric, in their order. */
    reason: z.literal("rubrics_missing"),
    missingDisciplines: z.array(z.enum(DISCIPLINES)).min(1),
  }),
  z.object({
    /**
     * School rounds not finished yet (#90): confirmed schools whose round
     * never opened, rounds still open, and overdue rounds.
     */
    reason: z.literal("school_rounds_unfinished"),
    missing: z.int().min(0),
    open: z.int().min(0),
    overdue: z.int().min(0),
  }),
]);

export type TransitionBlock = z.infer<typeof TRANSITION_BLOCK>;

export type TransitionBlockReason = TransitionBlock["reason"];

/** What a guard looks at: the competition as it is when the move is due. */
export type GuardedCompetition = {
  id: string;
  status: CompetitionStatus;
  disciplines: readonly Discipline[];
};

/**
 * A condition on one move of the status machine. The schedule makes the
 * move only while `check` finds nothing in the way; otherwise the move
 * waits, and is tried again after each `retryOn` event (each carries the
 * competition's id) and whenever another status job for it runs.
 */
export type CompetitionTransitionGuard = {
  from: CompetitionStatus;
  to: CompetitionStatus;
  retryOn: readonly EventType[];
  /** Why the move can't be made now, or null when it can. */
  check(
    db: AppDb,
    competition: GuardedCompetition
  ): Promise<TransitionBlock | null>;
};
