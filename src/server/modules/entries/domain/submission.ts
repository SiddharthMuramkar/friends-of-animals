// The rules for uploading an entry's file and for what a file's scan and
// processing outcome does to the entry. The use cases load the entry, ask
// these functions what to do, and write the answer in one transaction.
//
// - One entry per registration: the first upload creates it in
//   `processing`; later uploads retry it or replace its file.
// - Uploads are taken only while the submission window is open. An upload
//   counts when it is completed, so a file still being checked at the
//   deadline still counts.
// - A replacement is pending: the current file stays live until the new one
//   is live. A newer upload drops any upload still being checked.
// - Outcomes can arrive late or twice (the queue delivers at least once): an
//   outcome for a dropped or already settled file changes nothing.
//
// Pure: no I/O, no "server-only".

import {
  canMoveEntry,
  canMoveEntryFile,
  type EntryFileStatus,
  type EntryStatus,
} from "./status";

export type SubmissionWindow = { opensAt: Date; closesAt: Date };

/** Open from `opensAt` up to, not including, `closesAt`. */
export function windowState(
  window: SubmissionWindow,
  now: Date
): "not_open" | "open" | "closed" {
  if (now.getTime() < window.opensAt.getTime()) return "not_open";
  return now.getTime() < window.closesAt.getTime() ? "open" : "closed";
}

/** What the rules need to know about an entry and its files. */
export type EntrySnapshot = {
  status: EntryStatus;
  files: ReadonlyArray<{ id: string; status: EntryFileStatus }>;
};

export type UploadDecision =
  | {
      ok: true;
      /**
       * create: the registration's first entry, in `processing`.
       * retry: a rejected or failed entry goes back to `processing`.
       * replace: the entry keeps its status; the new file is pending.
       */
      action: "create" | "retry" | "replace";
      /** Files still being checked, which the new upload drops. */
      supersede: string[];
    }
  | {
      ok: false;
      reason:
        | "submission_not_open"
        | "deadline_passed"
        | "entry_locked"
        /** A sent-back entry's resubmission deadline has passed (#92). */
        | "resubmission_closed";
    };

const IN_FLIGHT: ReadonlySet<EntryFileStatus> = new Set([
  "pending",
  "processing",
]);

/** The entry's files still being checked. */
function inFlight(entry: EntrySnapshot): string[] {
  return entry.files
    .filter((file) => IN_FLIGHT.has(file.status))
    .map((file) => file.id);
}

/** Whether a new upload may go ahead now, and what it does. */
export function decideUpload({
  entry,
  window,
  now,
  resubmissionDueAt = null,
}: {
  entry: EntrySnapshot | null;
  window: SubmissionWindow;
  now: Date;
  /**
   * When the entry is sent back by FOA (#92): its resubmission deadline.
   * Until then a new file replaces the live one, whatever the submission
   * window says.
   */
  resubmissionDueAt?: Date | null;
}): UploadDecision {
  if (entry?.status === "sent_back") {
    if (!resubmissionDueAt || now.getTime() >= resubmissionDueAt.getTime()) {
      return { ok: false, reason: "resubmission_closed" };
    }
    return { ok: true, action: "replace", supersede: inFlight(entry) };
  }
  const state = windowState(window, now);
  if (state === "not_open") return { ok: false, reason: "submission_not_open" };
  if (state === "closed") return { ok: false, reason: "deadline_passed" };
  if (entry === null) return { ok: true, action: "create", supersede: [] };

  const supersede = inFlight(entry);
  if (canMoveEntry(entry.status, "processing")) {
    return { ok: true, action: "retry", supersede };
  }
  if (entry.status === "processing" || entry.status === "submitted") {
    return { ok: true, action: "replace", supersede };
  }
  return { ok: false, reason: "entry_locked" };
}

/** What the Files module reports about one uploaded file. */
export type FileOutcome =
  | "scan_clean"
  | "scan_infected"
  | "processed"
  | "processing_failed";

export type EntryEvent =
  | "entry.submitted"
  | "entry.rejected"
  | "entry.failed"
  | "entry.replacement_live"
  | "entry.replacement_rejected"
  | "entry.replacement_failed";

export type OutcomeDecision =
  | { applies: false }
  | {
      applies: true;
      /** The file's new status. */
      file: EntryFileStatus;
      /** The entry's new status, or null to leave it. */
      entry: EntryStatus | null;
      /** Files to mark superseded: the old live file, once a new one is live. */
      supersede: string[];
      /** The event to emit, or null for none. */
      event: EntryEvent | null;
    };

const OUTCOMES: Record<
  FileOutcome,
  {
    file: EntryFileStatus;
    /** Where an entry without a live file goes, and what it emits. */
    first: { entry: EntryStatus; event: EntryEvent } | null;
    /** What a replacement emits, while the entry keeps its status. */
    replacement: EntryEvent | null;
  }
> = {
  scan_clean: { file: "processing", first: null, replacement: null },
  scan_infected: {
    file: "rejected",
    first: { entry: "rejected", event: "entry.rejected" },
    replacement: "entry.replacement_rejected",
  },
  processed: {
    file: "live",
    first: { entry: "submitted", event: "entry.submitted" },
    replacement: "entry.replacement_live",
  },
  processing_failed: {
    file: "failed",
    first: { entry: "failed", event: "entry.failed" },
    replacement: "entry.replacement_failed",
  },
};

/** What one file's outcome does to the file, its entry and the old file. */
export function decideFileOutcome(
  entry: EntrySnapshot,
  fileId: string,
  outcome: FileOutcome
): OutcomeDecision {
  const target = entry.files.find((file) => file.id === fileId);
  const rule = OUTCOMES[outcome];
  if (!target || !canMoveEntryFile(target.status, rule.file)) {
    return { applies: false };
  }
  const supersede =
    rule.file === "live"
      ? entry.files
          .filter((file) => file.status === "live" && file.id !== fileId)
          .map((file) => file.id)
      : [];
  // Only an entry that has never had a live file is `processing`.
  if (rule.first && entry.status === "processing") {
    return {
      applies: true,
      file: rule.file,
      entry: rule.first.entry,
      supersede,
      event: rule.first.event,
    };
  }
  return {
    applies: true,
    file: rule.file,
    entry: null,
    supersede,
    event: rule.replacement,
  };
}
