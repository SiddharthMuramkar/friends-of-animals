// What the Files module has decided about an uploaded file so far, as the
// outcomes the entry rules take (./submission.ts), oldest first. The
// entries handler reads the file's state rather than trusting which event
// woke it: the scan's and the media job's events may arrive in any order,
// late or twice, and reading the state makes every delivery give the same
// answer.
//
// Pure: no I/O, no "server-only".

import type { FileStatus } from "../../files/domain/file-status";
import type { FileOutcome } from "./submission";

export type FileState = {
  status: FileStatus;
  /** The media job's status, or null if it has none. */
  processing: "queued" | "done" | "failed" | null;
};

export function outcomesOf(file: FileState): FileOutcome[] {
  switch (file.status) {
    case "quarantined":
      return ["scan_infected"];
    case "rejected":
      // The scanner passed it, but its bytes aren't the picture it was
      // declared as: as good as a picture that can't be opened.
      return ["scan_clean", "processing_failed"];
    case "clean":
      switch (file.processing) {
        case "done":
          return ["scan_clean", "processed"];
        case "failed":
          return ["scan_clean", "processing_failed"];
        default:
          return ["scan_clean"];
      }
    default:
      return [];
  }
}
