// The shortlist-only digital submission scope. Some competitions take only
// each school's shortlist digitally: students upload nothing, the school
// judges the physical work in school, and the coordinator creates an entry
// for each shortlisted student in the school round, uploading a photo or
// scan of the work. Pure: the use cases load the facts and act on what these
// functions decide.
//
// Owner decisions on #91:
// - The scope applies only to the school route. Individuals always submit
//   digitally.
// - A created entry reaches `submitted_to_foa` only once its upload is
//   processed and its round is finished. A failed upload leaves it
//   `school_shortlisted` until the coordinator uploads again.
// - "Not shortlisted" messages go by registration. No `not_shortlisted`
//   entry rows are created.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/** The competition's digital submission scope (#70's `DIGITAL_SCOPES`). */
type DigitalScope = "all_participants" | "shortlist_only";

/** How a registration reaches the competition. */
type Route = "individual" | "institution";

/** How an entry may be made digitally right now. */
export type SubmissionPath =
  /** The usual upload: by the participant or guardian, or the coordinator. */
  | "upload"
  /** The coordinator creates an already-shortlisted entry in the round. */
  | "shortlisted_entry";

/** Why no entry can be made digitally right now. */
export type SubmissionRefusal =
  /** The submission window isn't open. */
  | "submission_closed"
  /** Shortlist only: entries are made in the school round, not before. */
  | "submission_not_open"
  /** Shortlist only: the school round is finished. */
  | "round_not_editable";

export type SubmissionPathDecision =
  | { ok: true; path: SubmissionPath }
  | { ok: false; reason: SubmissionRefusal };

/**
 * Which way, if any, an entry for this registration can be made now. Entry
 * uploads proceed only on `upload`; creating a shortlisted entry only on
 * `shortlisted_entry`. Who may act is `can()`'s business, not this one's.
 */
export function digitalSubmissionPath(input: {
  scope: DigitalScope;
  route: Route;
  /** The competition's submission window is open now. */
  windowOpen: boolean;
  /** This registration's school round, or null before one exists. */
  schoolRound: { editable: boolean } | null;
}): SubmissionPathDecision {
  if (input.route === "individual" || input.scope === "all_participants") {
    return input.windowOpen
      ? { ok: true, path: "upload" }
      : { ok: false, reason: "submission_closed" };
  }
  if (input.schoolRound === null) {
    return { ok: false, reason: "submission_not_open" };
  }
  return input.schoolRound.editable
    ? { ok: true, path: "shortlisted_entry" }
    : { ok: false, reason: "round_not_editable" };
}

/**
 * What the coordinator declares for each entry they create, in form order.
 * Public-use consents (gallery, social media, auction) are not here: they
 * need the guardian's own consent and gate public use later.
 */
export const SHORTLIST_ONLY_DECLARATIONS = [
  /** The work is the student's own, made for this competition. */
  "original_work",
  /** The photo or scan shows the work as the school judged it. */
  "faithful_reproduction",
  /** The school's declaration covers the student's taking part and judging. */
  "participation_covered",
  /** The physical work stays with the school or student until FOA asks. */
  "physical_work_kept",
] as const;

export type ShortlistOnlyDeclaration =
  (typeof SHORTLIST_ONLY_DECLARATIONS)[number];

/** Stored with each declaration, so a later wording change is traceable. */
export const SHORTLIST_ONLY_DECLARATIONS_VERSION = "2026-11-draft";

export type DeclarationsCheck =
  | { ok: true; declarations: ShortlistOnlyDeclaration[] }
  | { ok: false; missing: ShortlistOnlyDeclaration[]; unknown: string[] };

function isDeclaration(key: string): key is ShortlistOnlyDeclaration {
  return (SHORTLIST_ONLY_DECLARATIONS as readonly string[]).includes(key);
}

/**
 * Checks the declarations ticked in the form: every one is required, and
 * an unknown key is refused rather than ignored.
 */
export function checkShortlistOnlyDeclarations(
  given: readonly string[]
): DeclarationsCheck {
  const ticked = new Set(given);
  const missing = SHORTLIST_ONLY_DECLARATIONS.filter((key) => !ticked.has(key));
  const unknown = [...ticked].filter((key) => !isDeclaration(key));
  return missing.length === 0 && unknown.length === 0
    ? { ok: true, declarations: [...SHORTLIST_ONLY_DECLARATIONS] }
    : { ok: false, missing, unknown };
}

/** What a created entry still waits for before it goes to FOA. */
export type PendingStep = "upload" | "finalise";

export type Readiness =
  /** Move the entry `school_shortlisted -> submitted_to_foa` now. */
  | { kind: "promote" }
  | { kind: "waiting"; for: PendingStep[] }
  /** Not a shortlist-only entry waiting to go to FOA. */
  | { kind: "no_action" };

/**
 * Whether a shortlist-only entry goes to FOA now. Both triggers (its file
 * going live, its round finishing) ask this one question, so whichever
 * comes second promotes the entry and a repeated trigger does nothing.
 */
export function shortlistOnlyReadiness(entry: {
  scope: DigitalScope;
  /** The entry's `entry_status`. */
  status: string;
  /** One of its files passed the scan and processing. */
  fileLive: boolean;
  /** Its round is finalised or was closed on the school's behalf. */
  roundFinished: boolean;
}): Readiness {
  if (
    entry.scope !== "shortlist_only" ||
    entry.status !== "school_shortlisted"
  ) {
    return { kind: "no_action" };
  }
  const waitingFor: PendingStep[] = [];
  if (!entry.fileLive) waitingFor.push("upload");
  if (!entry.roundFinished) waitingFor.push("finalise");
  return waitingFor.length === 0
    ? { kind: "promote" }
    : { kind: "waiting", for: waitingFor };
}

/** One created entry when its round is finalised. */
export type ShortlistOnlyOutcome = {
  entryId: string;
  registrationId: string;
  /** Every created entry is shortlisted: that is why it exists. */
  outcome: "shortlisted";
  position: number | null;
  /** On to FOA now, or nowhere until its upload is live. */
  statuses: readonly ["submitted_to_foa"] | readonly [];
};

/** Why the round's entries can't be finalised as they stand. */
export type ShortlistOnlyBlocker =
  /** The entry isn't for a confirmed student of this round. */
  | { code: "entry_not_in_round"; entryId: string }
  /** The registration already has an entry: one entry per registration. */
  | {
      code: "second_entry_for_registration";
      entryId: string;
      registrationId: string;
    };

export type ShortlistOnlyPlan =
  | {
      ok: true;
      outcomes: ShortlistOnlyOutcome[];
      /** Registrations whose families get the not-shortlisted message. */
      notShortlisted: string[];
    }
  | { ok: false; blockers: ShortlistOnlyBlocker[] };

/**
 * What finalising a shortlist-only round does to its entries and whom it
 * tells. Every created entry is shortlisted; those with a live file go to
 * FOA now and the rest when their file goes live. Every other confirmed
 * student is told, once, by registration. The panel, conduct and judging
 * checks are the same in both scopes and are made by the round's planner.
 */
export function planShortlistOnlyOutcomes(input: {
  /** The round's student registrations, confirmed or not. */
  enrolments: readonly { registrationId: string; confirmed: boolean }[];
  /** The entries the coordinator created in the round. */
  entries: readonly {
    entryId: string;
    registrationId: string;
    fileLive: boolean;
    position: number | null;
  }[];
}): ShortlistOnlyPlan {
  const confirmed = new Set(
    input.enrolments
      .filter((enrolment) => enrolment.confirmed)
      .map((enrolment) => enrolment.registrationId)
  );
  const blockers: ShortlistOnlyBlocker[] = [];
  const withEntry = new Set<string>();
  for (const { entryId, registrationId } of input.entries) {
    if (!confirmed.has(registrationId)) {
      blockers.push({ code: "entry_not_in_round", entryId });
    } else if (withEntry.has(registrationId)) {
      blockers.push({
        code: "second_entry_for_registration",
        entryId,
        registrationId,
      });
    }
    withEntry.add(registrationId);
  }
  if (blockers.length > 0) return { ok: false, blockers };

  const outcomes = input.entries.map((entry): ShortlistOnlyOutcome => ({
    entryId: entry.entryId,
    registrationId: entry.registrationId,
    outcome: "shortlisted",
    position: entry.position,
    statuses: entry.fileLive ? ["submitted_to_foa"] : [],
  }));
  const notShortlisted = [...confirmed].filter(
    (registrationId) => !withEntry.has(registrationId)
  );
  return { ok: true, outcomes, notShortlisted };
}
