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

/**
 * Reported (as a warning) when a run marks an unusually large share of a
 * bucket's copies as gone from R2. The copies are kept for the retention
 * window, so there is time to look before anything is purged.
 */
export class OffsiteMassDeletionWarning extends Error {
  constructor(buckets: readonly string[]) {
    super(
      `The off-site copy marked many objects as deleted from R2 in ${buckets.join(", ")}`
    );
    this.name = "OffsiteMassDeletionWarning";
  }
}

/** Thrown by a production run whose settings are missing or wrong. */
export class OffsiteCopyNotConfiguredError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The off-site copy can't run in production: ${problems.length} ` +
        "setting(s) missing or wrong (see docker/README.md)"
    );
    this.name = "OffsiteCopyNotConfiguredError";
    this.problems = problems;
  }
}
