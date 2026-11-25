// The coordinator's submission roster (#87): every student of one
// institution registration, with their entry's status and what the
// coordinator can do for them next. Pure: the use case loads the students,
// their entries and whether submission is open (the entries module's
// window rule and the competition's digital submission scope), and this
// decides what each row says.
//
// The roster's action is a hint for the list. The student's page asks the
// entries module itself, which also lets a coordinator replace a picture
// that is still being checked.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { DigitalScope } from "../../competitions/domain/vocabulary";
import { ENTRY_STATUSES, type EntryStatus } from "../../entries/domain/status";
import {
  windowState,
  type SubmissionWindow,
} from "../../entries/domain/submission";
import type { RegistrationStatus } from "../../registration/domain/registration-status";

/** A student's status on the roster: their entry's, or no entry yet. */
export type RosterStatus = EntryStatus | "not_started";

export const ROSTER_STATUSES: readonly RosterStatus[] = [
  "not_started",
  ...ENTRY_STATUSES,
];

/** What the coordinator can do for a student now. */
export type RosterAction = "submit" | "replace" | "retry";

/**
 * Whether the competition takes a coordinator's uploads now, as the
 * entries module's refusals name it when it doesn't.
 */
export type SubmissionGate =
  | "open"
  | "shortlist_only"
  | "submission_not_open"
  | "deadline_passed";

/**
 * The gate from the competition's digital submission scope and the entries
 * module's submission window (null while a date is missing).
 */
export function submissionGate(
  digitalScope: DigitalScope,
  window: SubmissionWindow | null,
  now: Date
): SubmissionGate {
  if (digitalScope !== "all_participants") return "shortlist_only";
  if (!window) return "submission_not_open";
  const state = windowState(window, now);
  return state === "open"
    ? "open"
    : state === "not_open"
      ? "submission_not_open"
      : "deadline_passed";
}

/** Why nothing can be done for a student now. */
export type RosterHold =
  | Exclude<SubmissionGate, "open">
  | "registration_not_confirmed";

export type RosterStudent = {
  registrationId: string;
  studentName: string;
  registrationNumber: string | null;
  registrationStatus: RegistrationStatus;
};

export type RosterEntry = {
  registrationId: string;
  /** The Entry ID. */
  code: string;
  status: EntryStatus;
  /** Its newest upload is still being checked. */
  checking: boolean;
};

export type RosterRow = RosterStudent & {
  entryCode: string | null;
  status: RosterStatus;
  checking: boolean;
  action: RosterAction | null;
  hold: RosterHold | null;
};

export type SubmissionRoster = {
  rows: RosterRow[];
  counts: {
    total: number;
    byStatus: Record<RosterStatus, number>;
    /** Students who still need a first upload, or another after a refusal. */
    needingUpload: number;
  };
};

const byName = new Intl.Collator("en-IN", { sensitivity: "base" });

function actionFor(entry: RosterEntry | undefined): RosterAction | null {
  if (!entry) return "submit";
  switch (entry.status) {
    case "rejected":
    case "failed":
      return "retry";
    case "submitted":
      return entry.checking ? null : "replace";
    default:
      return null;
  }
}

/**
 * Every student, ordered by name, with their status and next step. Throws
 * when an entry belongs to nobody on the roster, or a student has two: a
 * scoping mistake in the caller must never show another school's student.
 */
export function buildSubmissionRoster(input: {
  students: readonly RosterStudent[];
  entries: readonly RosterEntry[];
  gate: SubmissionGate;
}): SubmissionRoster {
  const onRoster = new Set(input.students.map((each) => each.registrationId));
  const entries = new Map<string, RosterEntry>();
  for (const entry of input.entries) {
    if (!onRoster.has(entry.registrationId)) {
      throw new Error(`Entry ${entry.code} is for someone not on this roster`);
    }
    if (entries.has(entry.registrationId)) {
      throw new Error(
        `Registration ${entry.registrationId} has more than one entry`
      );
    }
    entries.set(entry.registrationId, entry);
  }

  const rows = input.students.map((student): RosterRow => {
    const entry = entries.get(student.registrationId);
    const hold: RosterHold | null =
      student.registrationStatus !== "confirmed"
        ? "registration_not_confirmed"
        : input.gate === "open"
          ? null
          : input.gate;
    return {
      ...student,
      entryCode: entry?.code ?? null,
      status: entry?.status ?? "not_started",
      checking: entry?.checking ?? false,
      action: hold ? null : actionFor(entry),
      hold,
    };
  });
  rows.sort(
    (a, b) =>
      byName.compare(a.studentName, b.studentName) ||
      (a.registrationId < b.registrationId ? -1 : 1)
  );

  const byStatus = Object.fromEntries(
    ROSTER_STATUSES.map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ])
  ) as Record<RosterStatus, number>;
  return {
    rows,
    counts: {
      total: rows.length,
      byStatus,
      needingUpload: rows.filter(
        (row) => row.action === "submit" || row.action === "retry"
      ).length,
    },
  };
}
