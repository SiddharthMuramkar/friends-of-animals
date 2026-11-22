// How a night's run ends. An incomplete run throws, so pg-boss retries it
// with backoff; each retry copies only what is still missing, because every
// success is in the manifest. Sentry hears about a failure once, on the
// final attempt, instead of on every retry.

/** What went wrong across all buckets in one run. */
export type RunTally = {
  /** Objects whose copy, mark or purge failed. */
  failedObjects: number;
  /** Buckets whose listing failed or was refused. */
  failedBuckets: number;
  /** Buckets where this run marked unusually many copies. */
  massDeletionBuckets: number;
};

export type RunOutcome = {
  /** Deferred copies (out of time) don't make a run incomplete. */
  status: "complete" | "incomplete";
  reportError: boolean;
  reportWarning: boolean;
};

export function decideRunOutcome(
  tally: RunTally,
  attempt: { finalAttempt: boolean }
): RunOutcome {
  const incomplete = tally.failedObjects > 0 || tally.failedBuckets > 0;
  return {
    status: incomplete ? "incomplete" : "complete",
    reportError: incomplete && attempt.finalAttempt,
    reportWarning: tally.massDeletionBuckets > 0,
  };
}

const MAX_EXAMPLES = 10;
const MAX_ERROR_LENGTH = 200;

export type CopyFailure = { bucket: string; key: string; error: unknown };

/**
 * What the Sentry event carries about failed objects: counts by error name
 * and a few examples. Keys hold no personal data (63a builds them from the
 * purpose and a UUID), and 66a's scrubber still runs over the event.
 */
export function failureDigest(failures: readonly CopyFailure[]): {
  total: number;
  byError: Record<string, number>;
  examples: { bucket: string; key: string; error: string }[];
} {
  const byError: Record<string, number> = {};
  for (const { error } of failures) {
    const name = error instanceof Error ? error.name : "NonError";
    byError[name] = (byError[name] ?? 0) + 1;
  }
  return {
    total: failures.length,
    byError,
    examples: failures.slice(0, MAX_EXAMPLES).map(({ bucket, key, error }) => ({
      bucket,
      key,
      error: errorSummary(error),
    })),
  };
}

/** An error's name and message, cut short for a report. */
export function errorSummary(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}
