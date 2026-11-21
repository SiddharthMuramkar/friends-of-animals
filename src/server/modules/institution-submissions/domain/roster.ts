// The coordinator dashboard's list of students: every student enrolled
// through one institution registration, with their entry's status and what
// the coordinator can do next. Pure: the use case loads the students, their
// entries and whether the submission window is open (from Entries' deadline
// rule, so there is one deadline rule), and renders the result.
//
// Loads under plain Node, so no "server-only" here.

import {
  coordinatorMaySubmit,
  type CoordinatorScope,
  type StudentRegistration,
  type SubmitRefusal,
} from "./eligibility";

/**
 * An entry's status, as Entries stores it. Every value exists from the
 * start; later tickets add transitions, never values.
 */
export type EntryStatus =
  | "processing"
  | "submitted"
  | "rejected"
  | "failed"
  | "school_shortlisted"
  | "not_shortlisted"
  | "submitted_to_foa"
  | "foa_verified"
  | "sent_back";

/** A student's status on the roster: their entry's, or no entry yet. */
export type RosterStatus = EntryStatus | "not_started";

/** What the coordinator can do for a student right now. */
export type RosterAction = "submit" | "replace" | "retry";

export type RosterStudent = {
  registrationId: string;
  studentName: string;
  registration: StudentRegistration;
};

export type RosterEntry = {
  registrationId: string;
  /** The Entry ID shown to people. */
  code: string;
  status: EntryStatus;
  /** A new file is uploaded and still being checked; the old one stays live. */
  replacementPending: boolean;
};

export type RosterRow = {
  registrationId: string;
  studentName: string;
  entryCode: string | null;
  status: RosterStatus;
  replacementPending: boolean;
  action: RosterAction | null;
  /** Why this student can't get an entry, when that's the reason. */
  refusal: SubmitRefusal | null;
};

export type SubmissionRoster = {
  rows: RosterRow[];
  counts: {
    total: number;
    /** Only statuses that occur are present. */
    byStatus: Partial<Record<RosterStatus, number>>;
  };
};

const collator = new Intl.Collator("en-IN", { sensitivity: "base" });

/** What a coordinator can do for an eligible student while the window is open. */
function actionFor(entry: RosterEntry | undefined): RosterAction | null {
  if (!entry) return "submit";
  switch (entry.status) {
    case "submitted":
      return entry.replacementPending ? null : "replace";
    case "rejected":
    case "failed":
      return "retry";
    default:
      return null;
  }
}

/**
 * Every student, ordered by name, with their status and next action. Throws
 * if a student or entry doesn't belong to this coordinator's roster: that is
 * a scoping bug in the caller, and the roster must never show it.
 */
export function buildSubmissionRoster(input: {
  students: readonly RosterStudent[];
  entries: readonly RosterEntry[];
  scope: CoordinatorScope;
  /** Whether Entries' deadline rule still accepts uploads. */
  windowOpen: boolean;
}): SubmissionRoster {
  const studentIds = new Set(input.students.map((s) => s.registrationId));
  if (studentIds.size !== input.students.length) {
    throw new Error("A registration is listed more than once on this roster");
  }
  const entries = new Map<string, RosterEntry>();
  for (const entry of input.entries) {
    if (!studentIds.has(entry.registrationId)) {
      throw new Error(
        `Entry ${entry.code} belongs to a registration that is not on this roster`
      );
    }
    if (entries.has(entry.registrationId)) {
      throw new Error(
        `Registration ${entry.registrationId} has more than one entry`
      );
    }
    entries.set(entry.registrationId, entry);
  }

  const rows = input.students.map((student): RosterRow => {
    const decision = coordinatorMaySubmit(student.registration, input.scope);
    if (!decision.ok && decision.reason !== "not_confirmed") {
      throw new Error(
        `Registration ${student.registrationId} is outside the coordinator's institutions`
      );
    }
    const entry = entries.get(student.registrationId);
    return {
      registrationId: student.registrationId,
      studentName: student.studentName,
      entryCode: entry?.code ?? null,
      status: entry?.status ?? "not_started",
      replacementPending: entry?.replacementPending ?? false,
      action: decision.ok && input.windowOpen ? actionFor(entry) : null,
      refusal: decision.ok ? null : decision.reason,
    };
  });

  rows.sort(
    (a, b) =>
      collator.compare(a.studentName, b.studentName) ||
      (a.registrationId < b.registrationId ? -1 : 1)
  );

  const byStatus: Partial<Record<RosterStatus, number>> = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }

  return { rows, counts: { total: rows.length, byStatus } };
}
