// The entry status machine and the entry file status machine.
//
// Every entry status the digital rounds need exists from the start, so later
// tickets add allowed moves to these tables, never values to the enum (a
// value added and used in one migration run fails). A status no move reaches
// yet is simply forbidden from everywhere until its ticket adds the move.
//
// An entry's status says where the entry is; each uploaded file has its own
// status. `processing`, `rejected` and `failed` describe only an entry that
// has never had a live file: a replacement is checked while the entry stays
// `submitted` and its current file stays live.
//
// Pure: no I/O, no "server-only".

export const ENTRY_STATUSES = [
  "processing",
  "submitted",
  "rejected",
  "failed",
  "school_shortlisted",
  "not_shortlisted",
  "submitted_to_foa",
  "foa_verified",
  "sent_back",
] as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_FILE_STATUSES = [
  /** Uploaded, waiting for the malware scan. */
  "pending",
  /** Scanned clean, derived copies being made. */
  "processing",
  /** The entry's current file. At most one per entry. */
  "live",
  /** The scan found malware. */
  "rejected",
  /** The file couldn't be processed (corrupt, not really an image). */
  "failed",
  /** Replaced by a newer upload. */
  "superseded",
] as const;

export type EntryFileStatus = (typeof ENTRY_FILE_STATUSES)[number];

type Move<S extends string, Trigger extends string> = {
  /** null: the row is being created. */
  from: S | null;
  to: S;
  trigger: Trigger;
};

export type EntryTrigger =
  | "upload_completed"
  | "file_live"
  | "file_infected"
  | "file_failed"
  | "upload_retried"
  /** Picked in a finalised school round (#89). */
  | "school_shortlisted"
  /** Under all-participants scope, a shortlisted entry goes on to FOA. */
  | "sent_to_foa"
  /** Not picked in a finalised school round (#89). */
  | "not_shortlisted"
  | "essay_typed"
  /** Submissions closed: an individual entry goes on to FOA (#92). */
  | "forwarded_to_foa"
  /** An FOA verifier verified the entry (#92). */
  | "foa_verified"
  /** An FOA verifier sent the entry back with a reason (#92). */
  | "sent_back"
  /** A sent-back entry was resubmitted in time (#92). */
  | "resubmitted"
  /** The new file a sent-back entry was resubmitted with went live (#92). */
  | "resubmission_live";

export const ENTRY_MOVES: readonly Move<EntryStatus, EntryTrigger>[] = [
  { from: null, to: "processing", trigger: "upload_completed" },
  { from: "processing", to: "submitted", trigger: "file_live" },
  { from: "processing", to: "rejected", trigger: "file_infected" },
  { from: "processing", to: "failed", trigger: "file_failed" },
  { from: "rejected", to: "processing", trigger: "upload_retried" },
  { from: "failed", to: "processing", trigger: "upload_retried" },
  // Finalising a school round (#89).
  {
    from: "submitted",
    to: "school_shortlisted",
    trigger: "school_shortlisted",
  },
  {
    from: "school_shortlisted",
    to: "submitted_to_foa",
    trigger: "sent_to_foa",
  },
  { from: "processing", to: "not_shortlisted", trigger: "not_shortlisted" },
  { from: "rejected", to: "not_shortlisted", trigger: "not_shortlisted" },
  { from: "failed", to: "not_shortlisted", trigger: "not_shortlisted" },
  { from: "submitted", to: "not_shortlisted", trigger: "not_shortlisted" },
  // A typed essay has nothing to check, so it counts at once (#86, the
  // owner's ruling of 2026-11-19). A rejected or failed entry retried with
  // one goes back to processing first, then here.
  { from: null, to: "submitted", trigger: "essay_typed" },
  { from: "processing", to: "submitted", trigger: "essay_typed" },
  // FOA verification (#92). The individual route skips the school round:
  // its submitted entries go on to FOA once submissions close. A verifier
  // verifies an entry or sends it back; a sent-back entry resubmitted
  // before its deadline waits for a verifier again (owner decision
  // 2026-11-19: no separate resubmitted status). Nothing leaves
  // foa_verified here.
  {
    from: "submitted",
    to: "submitted_to_foa",
    trigger: "forwarded_to_foa",
  },
  { from: "submitted_to_foa", to: "foa_verified", trigger: "foa_verified" },
  { from: "submitted_to_foa", to: "sent_back", trigger: "sent_back" },
  { from: "sent_back", to: "submitted_to_foa", trigger: "resubmitted" },
  {
    from: "sent_back",
    to: "submitted_to_foa",
    trigger: "resubmission_live",
  },
];

export type EntryFileTrigger =
  | "upload_completed"
  | "scan_clean"
  | "scan_infected"
  | "processed"
  | "processing_failed"
  | "newer_upload"
  | "replacement_live"
  | "essay_typed";

export const ENTRY_FILE_MOVES: readonly Move<
  EntryFileStatus,
  EntryFileTrigger
>[] = [
  { from: null, to: "pending", trigger: "upload_completed" },
  // A typed essay (#86) is live as soon as it is saved.
  { from: null, to: "live", trigger: "essay_typed" },
  { from: "pending", to: "processing", trigger: "scan_clean" },
  { from: "pending", to: "rejected", trigger: "scan_infected" },
  { from: "processing", to: "live", trigger: "processed" },
  { from: "processing", to: "failed", trigger: "processing_failed" },
  { from: "pending", to: "superseded", trigger: "newer_upload" },
  { from: "processing", to: "superseded", trigger: "newer_upload" },
  { from: "live", to: "superseded", trigger: "replacement_live" },
];

/** Thrown when code asks for a move the table doesn't allow. */
export class EntryTransitionError extends Error {
  readonly code = "invalid_transition";

  constructor(
    readonly machine: "entry" | "entry_file",
    readonly from: string | null,
    readonly to: string
  ) {
    super(`An ${machine} can't move from ${from ?? "(new)"} to ${to}`);
    this.name = "EntryTransitionError";
  }
}

function allows<S extends string>(
  moves: readonly Move<S, string>[],
  from: S | null,
  to: S
): boolean {
  return moves.some((move) => move.from === from && move.to === to);
}

export function canMoveEntry(from: EntryStatus | null, to: EntryStatus) {
  return allows(ENTRY_MOVES, from, to);
}

/** `to`, if an entry may move there from `from`; throws otherwise. */
export function moveEntry(from: EntryStatus | null, to: EntryStatus) {
  if (!canMoveEntry(from, to))
    throw new EntryTransitionError("entry", from, to);
  return to;
}

export function canMoveEntryFile(
  from: EntryFileStatus | null,
  to: EntryFileStatus
) {
  return allows(ENTRY_FILE_MOVES, from, to);
}

/** `to`, if an entry file may move there from `from`; throws otherwise. */
export function moveEntryFile(
  from: EntryFileStatus | null,
  to: EntryFileStatus
) {
  if (!canMoveEntryFile(from, to)) {
    throw new EntryTransitionError("entry_file", from, to);
  }
  return to;
}
