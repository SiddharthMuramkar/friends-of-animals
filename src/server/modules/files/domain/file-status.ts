// The life of an uploaded file. Every status change in the Files module goes
// through `nextFileStatus`, so a file can only become `clean` through a scan
// and never comes back from `quarantined`, `rejected` or `deleted`.

/** In the order a file normally passes through them. */
export const FILE_STATUSES = [
  /** Presigned; the browser hasn't finished its PUT. */
  "pending_upload",
  /** The object is stored and matches its declaration; awaiting a scan. */
  "uploaded",
  /** The worker is scanning it (again, on a retry). */
  "scanning",
  /** Scanned and safe: deliverable to anyone `can()` allows. */
  "clean",
  /** The scanner flagged it. Never delivered, to anyone. */
  "quarantined",
  /** Its bytes didn't match what was declared (size, type). */
  "rejected",
  /** Removed. */
  "deleted",
] as const;

export type FileStatus = (typeof FILE_STATUSES)[number];

export type FileEvent =
  | "upload_confirmed"
  | "upload_rejected"
  | "scan_started"
  | "scan_passed"
  | "scan_found_malware"
  | "scan_rejected"
  | "deleted";

const TRANSITIONS: Record<
  FileStatus,
  Partial<Record<FileEvent, FileStatus>>
> = {
  pending_upload: {
    upload_confirmed: "uploaded",
    upload_rejected: "rejected",
    deleted: "deleted",
  },
  uploaded: { scan_started: "scanning", deleted: "deleted" },
  scanning: {
    scan_started: "scanning",
    scan_passed: "clean",
    scan_found_malware: "quarantined",
    scan_rejected: "rejected",
    deleted: "deleted",
  },
  clean: { deleted: "deleted" },
  quarantined: { deleted: "deleted" },
  rejected: { deleted: "deleted" },
  deleted: {},
};

/** The status `event` moves a file in `from` to, or null if it can't. */
export function nextFileStatus(
  from: FileStatus,
  event: FileEvent
): FileStatus | null {
  return TRANSITIONS[from][event] ?? null;
}
