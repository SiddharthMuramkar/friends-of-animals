// The school round's shortlist deadline. When it arrives, every round the
// school hasn't finalised becomes overdue; nothing is ever finalised
// automatically, and the school can still finalise late. The competition
// can't move on to FOA judging while any confirmed school's round is
// unfinished.
//
// The deadline job carries the instant it was scheduled for, so a job left
// over from a deadline that has since moved does nothing, as competition
// status jobs do.
//
// Pure: no imports. The status union below matches the school round's
// machine, which owns the full list.

type RoundStatus = "open" | "overdue" | "finalised" | "closed_on_behalf";

const FINISHED: readonly RoundStatus[] = ["finalised", "closed_on_behalf"];

/** Whether the round is decided: finalised, or closed on the school's behalf. */
export function isSchoolRoundFinished(status: RoundStatus): boolean {
  return FINISHED.includes(status);
}

export type DeadlineFacts = {
  /** The competition's shortlist deadline as it is now. */
  deadline: Date | null;
  inSchoolJudging: boolean;
  /** Every school round of the competition. */
  rounds: readonly { roundId: string; status: RoundStatus }[];
};

/** What a deadline job does when it runs. */
export type DeadlineJobPlan =
  /** The deadline moved or went; another job (or none) covers it. */
  | { kind: "stale" }
  /** It ran before its instant; schedule it again for `dueAt`. */
  | { kind: "early"; dueAt: Date }
  /** The competition isn't in school judging any more. */
  | { kind: "inactive" }
  /** Move these rounds from open to overdue. Empty when none is open. */
  | { kind: "mark_overdue"; roundIds: string[] };

/**
 * Decides what a deadline job does for the competition as it is now. The
 * deadline counts as passed at that very instant.
 */
export function planRoundDeadlineJob(
  job: { dueAt: Date },
  facts: DeadlineFacts,
  now: Date
): DeadlineJobPlan {
  if (facts.deadline?.getTime() !== job.dueAt.getTime()) {
    return { kind: "stale" };
  }
  if (!facts.inSchoolJudging) return { kind: "inactive" };
  if (now.getTime() < job.dueAt.getTime()) {
    return { kind: "early", dueAt: job.dueAt };
  }
  return {
    kind: "mark_overdue",
    roundIds: facts.rounds
      .filter((round) => round.status === "open")
      .map((round) => round.roundId),
  };
}

/** The guard's verdict on moving the competition to FOA judging. */
export type RoundsFinishedOutcome =
  | { pass: true }
  | {
      pass: false;
      reason: "school_rounds_unfinished";
      details: { missing: number; open: number; overdue: number };
    };

/**
 * Whether every confirmed school's round is finished. A confirmed school
 * with no round yet counts as unfinished, so the competition can't reach
 * FOA judging before its rounds have even been opened.
 */
export function checkSchoolRoundsFinished(
  schools: readonly {
    institutionRegistrationId: string;
    roundStatus: RoundStatus | null;
  }[]
): RoundsFinishedOutcome {
  const details = { missing: 0, open: 0, overdue: 0 };
  for (const { roundStatus } of schools) {
    if (roundStatus === null) details.missing += 1;
    else if (roundStatus === "open") details.open += 1;
    else if (roundStatus === "overdue") details.overdue += 1;
  }
  const unfinished = details.missing + details.open + details.overdue;
  return unfinished === 0
    ? { pass: true }
    : { pass: false, reason: "school_rounds_unfinished", details };
}
