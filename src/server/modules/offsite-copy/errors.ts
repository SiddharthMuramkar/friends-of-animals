// What a night's off-site copy throws or reports.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import type { OffsiteRunReport } from "./run-copy";

type FinishedReport = Exclude<OffsiteRunReport, { status: "skipped" }>;

/**
 * Thrown by a run that left something undone, so pg-boss retries it with
 * backoff. A retry copies only what is still missing.
 */
export class OffsiteCopyIncompleteError extends Error {
  readonly report: FinishedReport;

  constructor(report: FinishedReport) {
    super(
      `The off-site copy is incomplete: ${report.failed} object(s) and ` +
        `${report.failedBuckets.length} bucket(s) failed`
    );
    this.name = "OffsiteCopyIncompleteError";
    this.report = report;
  }
}
