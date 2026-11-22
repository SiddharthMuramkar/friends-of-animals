import { describe, expect, it } from "vitest";

import { decideRunOutcome, failureDigest } from "./outcome";

const CLEAN = { failedObjects: 0, failedBuckets: 0, massDeletionBuckets: 0 };

describe("decideRunOutcome", () => {
  it("completes quietly when nothing failed", () => {
    expect(decideRunOutcome(CLEAN, { finalAttempt: false })).toEqual({
      status: "complete",
      reportError: false,
      reportWarning: false,
    });
  });

  it("is incomplete when an object or a bucket failed, so pg-boss retries", () => {
    for (const tally of [
      { ...CLEAN, failedObjects: 1 },
      { ...CLEAN, failedBuckets: 1 },
    ]) {
      expect(decideRunOutcome(tally, { finalAttempt: false }).status).toBe(
        "incomplete"
      );
    }
  });

  it("reports a failure to Sentry only on the final attempt", () => {
    const failed = { ...CLEAN, failedObjects: 2 };
    expect(decideRunOutcome(failed, { finalAttempt: false }).reportError).toBe(
      false
    );
    expect(decideRunOutcome(failed, { finalAttempt: true }).reportError).toBe(
      true
    );
  });

  it("warns about a mass deletion on the run that found it, and still completes", () => {
    expect(
      decideRunOutcome(
        { ...CLEAN, massDeletionBuckets: 1 },
        { finalAttempt: false }
      )
    ).toEqual({ status: "complete", reportError: false, reportWarning: true });
  });
});

describe("failureDigest", () => {
  it("counts failures by error name and keeps at most ten examples", () => {
    const failures = Array.from({ length: 12 }, (_, n) => ({
      bucket: "foa-private",
      key: `general/${n}`,
      error: n < 9 ? new TypeError("fetch failed") : new Error("SlowDown"),
    }));
    const digest = failureDigest(failures);
    expect(digest.total).toBe(12);
    expect(digest.byError).toEqual({ TypeError: 9, Error: 3 });
    expect(digest.examples).toHaveLength(10);
    expect(digest.examples[0]).toEqual({
      bucket: "foa-private",
      key: "general/0",
      error: "TypeError: fetch failed",
    });
  });

  it("cuts a long error message and handles a thrown non-Error", () => {
    const digest = failureDigest([
      { bucket: "b-1", key: "k", error: new Error("x".repeat(500)) },
      { bucket: "b-1", key: "k2", error: "plain string" },
    ]);
    expect(digest.examples[0]?.error).toHaveLength(200);
    expect(digest.examples[1]?.error).toBe("plain string");
    expect(digest.byError).toEqual({ Error: 1, NonError: 1 });
  });
});
