// What finalising a school round does, decided without touching the
// database. The finalise use case gathers the facts, asks for a plan and,
// if there is one, applies it in one transaction; the coordinator's page
// shows the same blockers as a checklist before the button is pressed.
//
// This is the all-participants scope (#55's default): every student
// submitted digitally, so a shortlisted entry goes straight on to FOA with
// the file already uploaded. The shortlist-only scope adds its own variant.

import type { Pick } from "./picks";

/** What the use case knows about the round when the coordinator finalises. */
export type FinaliseFacts = {
  /** Members of the recorded judging panel. */
  panelSize: number;
  /** The institution certified the competition was run by the rules. */
  conductCertified: boolean;
  /** The coordinator ticked the judging attestation in the finalise form. */
  judgingAttested: boolean;
  /** Every entry of the institution's students in this competition. */
  entries: readonly { entryId: string; submitted: boolean }[];
  /** The saved shortlist, every category together. */
  picks: readonly Pick[];
  /**
   * Who decides the round: the school finalising it (the default), or a
   * competition manager closing an overdue round on its behalf (#90). The
   * manager applies the school's saved picks as they are, so the panel,
   * conduct certification and attestation the school owes aren't asked.
   */
  by?: "school" | "manager";
};

/** The entry statuses each outcome moves through, in order. */
const SHORTLISTED_STATUSES = [
  "school_shortlisted",
  "submitted_to_foa",
] as const;
const NOT_SHORTLISTED_STATUSES = ["not_shortlisted"] as const;

/** What happens to one entry. Families are told which. */
export type EntryOutcome =
  | {
      entryId: string;
      outcome: "shortlisted";
      /** The school position, if the coordinator declared one. */
      position: number | null;
      statuses: typeof SHORTLISTED_STATUSES;
    }
  | {
      entryId: string;
      outcome: "not_shortlisted";
      position: null;
      statuses: typeof NOT_SHORTLISTED_STATUSES;
    };

/** Why the round can't be finalised yet. */
export type FinaliseBlocker =
  /** No judging panel recorded: at least one member is needed. */
  | { code: "panel_missing" }
  /** The institution hasn't certified the competition's conduct. */
  | { code: "conduct_not_certified" }
  /** The coordinator didn't attest the judging. */
  | { code: "judging_not_attested" }
  /** A saved pick isn't one of the round's entries. */
  | { code: "pick_not_in_round"; entryId: string }
  /** A saved pick never reached `submitted`. */
  | { code: "pick_not_submitted"; entryId: string };

export type FinalisationPlan =
  | { ok: true; outcomes: EntryOutcome[] }
  | { ok: false; blockers: FinaliseBlocker[] };

/**
 * Plans the finalisation of a school round from what is known about it:
 * either every entry's outcome, or every reason it can't happen yet. The
 * round's own status is checked by the status machine, not here.
 */
export function planFinalisation(facts: FinaliseFacts): FinalisationPlan {
  const blockers: FinaliseBlocker[] = [];
  if ((facts.by ?? "school") === "school") {
    if (facts.panelSize < 1) blockers.push({ code: "panel_missing" });
    if (!facts.conductCertified) {
      blockers.push({ code: "conduct_not_certified" });
    }
    if (!facts.judgingAttested) blockers.push({ code: "judging_not_attested" });
  }

  // Saving picks already refuses these; finalising checks again rather
  // than move an entry the shortlist rules never allowed.
  const submitted = new Map(
    facts.entries.map((entry) => [entry.entryId, entry.submitted])
  );
  for (const { entryId } of facts.picks) {
    const isSubmitted = submitted.get(entryId);
    if (isSubmitted === undefined) {
      blockers.push({ code: "pick_not_in_round", entryId });
    } else if (!isSubmitted) {
      blockers.push({ code: "pick_not_submitted", entryId });
    }
  }
  if (blockers.length > 0) return { ok: false, blockers };

  const positions = new Map(
    facts.picks.map((pick) => [pick.entryId, pick.position])
  );
  const outcomes = facts.entries.map(({ entryId }): EntryOutcome => {
    const position = positions.get(entryId);
    return position === undefined
      ? {
          entryId,
          outcome: "not_shortlisted",
          position: null,
          statuses: NOT_SHORTLISTED_STATUSES,
        }
      : {
          entryId,
          outcome: "shortlisted",
          position,
          statuses: SHORTLISTED_STATUSES,
        };
  });
  return { ok: true, outcomes };
}
