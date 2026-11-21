// What reopening a decided school round does, decided without touching the
// database. A competition manager reopens a round the school finalised, or
// one closed on its behalf, while the competition is still in school
// judging and before FOA has decided on any of its entries. Every entry
// goes back to where it was before the round was decided; the saved picks
// stay as the school's draft, and families hear nothing until the round is
// decided again.
//
// Pure: no imports. The status unions below match the school round's and
// the entries' machines, which own the full lists.

type RoundStatus = "open" | "overdue" | "finalised" | "closed_on_behalf";

type EntryStatus =
  | "processing"
  | "submitted"
  | "rejected"
  | "failed"
  | "school_shortlisted"
  | "not_shortlisted"
  | "submitted_to_foa"
  | "foa_verified"
  | "sent_back";

/** Statuses an entry can be in when its round is decided. */
const BEFORE_DECISION: readonly EntryStatus[] = [
  "processing",
  "submitted",
  "rejected",
  "failed",
  "school_shortlisted",
];

/** Statuses deciding the round moves an entry to. Only these are reverted. */
const DECIDED: readonly EntryStatus[] = [
  "school_shortlisted",
  "not_shortlisted",
  "submitted_to_foa",
];

/** FOA has decided on the entry: the round's outcome is relied on. */
const VERIFIED: readonly EntryStatus[] = ["foa_verified", "sent_back"];

export type ReopenFacts = {
  competitionInSchoolJudging: boolean;
  roundStatus: RoundStatus;
  /** The competition's shortlist deadline, if it has one. */
  shortlistDeadline: Date | null;
  now: Date;
  /** Every entry the round's decision covered. */
  entries: readonly {
    entryId: string;
    status: EntryStatus;
    /** The status recorded when the round was decided. */
    statusBefore: EntryStatus;
    /** The entry has a live file now (it may have gone live since). */
    hasLiveFile: boolean;
  }[];
};

/** Why the round can't be reopened. */
export type ReopenBlocker =
  /** Reopening is only possible during school judging. */
  | { code: "competition_not_in_school_judging" }
  /** The round is still open or overdue: there is nothing to reopen. */
  | { code: "round_not_finished" }
  /** FOA has verified the entry or sent it back. */
  | { code: "entry_verified"; entryId: string };

/** One entry's move back to where it was before the round was decided. */
export type EntryRevert = {
  entryId: string;
  from: EntryStatus;
  to: EntryStatus;
};

export type ReopenPlan =
  | {
      ok: true;
      /** Overdue once the shortlist deadline has passed, else open. */
      roundStatus: "open" | "overdue";
      reverts: EntryRevert[];
    }
  | { ok: false; blockers: ReopenBlocker[] };

/**
 * The status an entry returns to. An entry still processing when the round
 * was decided whose file has since gone live is submitted: processing only
 * ever describes an entry that has never had a live file.
 */
function revertTarget(entry: ReopenFacts["entries"][number]): EntryStatus {
  if (!BEFORE_DECISION.includes(entry.statusBefore)) {
    throw new RangeError(
      `Entry ${entry.entryId} can't have been ${entry.statusBefore} when its round was decided`
    );
  }
  return entry.statusBefore === "processing" && entry.hasLiveFile
    ? "submitted"
    : entry.statusBefore;
}

/**
 * Plans reopening a school round: either the round's new status and every
 * entry's move back, or every reason it can't happen.
 */
export function planReopen(facts: ReopenFacts): ReopenPlan {
  const blockers: ReopenBlocker[] = [];
  if (!facts.competitionInSchoolJudging) {
    blockers.push({ code: "competition_not_in_school_judging" });
  }
  if (facts.roundStatus === "open" || facts.roundStatus === "overdue") {
    blockers.push({ code: "round_not_finished" });
  }
  for (const entry of facts.entries) {
    if (VERIFIED.includes(entry.status)) {
      blockers.push({ code: "entry_verified", entryId: entry.entryId });
    }
  }
  if (blockers.length > 0) return { ok: false, blockers };

  const reverts = facts.entries.flatMap((entry): EntryRevert[] => {
    const to = revertTarget(entry);
    return DECIDED.includes(entry.status) && entry.status !== to
      ? [{ entryId: entry.entryId, from: entry.status, to }]
      : [];
  });
  const deadlinePassed =
    facts.shortlistDeadline !== null &&
    facts.now.getTime() >= facts.shortlistDeadline.getTime();
  return {
    ok: true,
    roundStatus: deadlinePassed ? "overdue" : "open",
    reverts,
  };
}
