import { describe, expect, it } from "vitest";

import { RESULTS_RELEASE_STATUSES } from "./release-status";
import { planPublish, publishesOnApproval } from "./publish-plan";

const T = new Date("2027-03-01T04:30:00.000Z");
const before = (ms: number) => new Date(T.getTime() - ms);
const after = (ms: number) => new Date(T.getTime() + ms);

const approved = {
  status: "approved" as const,
  publishAt: T,
  storedHash: "a".repeat(64),
  contentHash: "a".repeat(64),
};

describe("planPublish", () => {
  it("waits when the job runs a second early", () => {
    expect(planPublish(approved, before(1000))).toEqual({
      kind: "early",
      dueAt: T,
    });
  });

  it("publishes at the instant, stamped with the time it ran", () => {
    expect(planPublish(approved, T)).toEqual({ kind: "publish", at: T });
    expect(planPublish(approved, after(90_000))).toEqual({
      kind: "publish",
      at: after(90_000),
    });
  });

  it.each(RESULTS_RELEASE_STATUSES.filter((s) => s !== "approved"))(
    "does nothing for a %s release, so a second run or a cancelled one is a no-op",
    (status) => {
      expect(planPublish({ ...approved, status }, after(1000))).toEqual({
        kind: "skip",
        reason: "not_approved",
      });
    }
  );

  it("rejects a release whose content no longer matches the approved hash", () => {
    expect(
      planPublish({ ...approved, contentHash: "b".repeat(64) }, T)
    ).toEqual({ kind: "reject", reason: "stale_snapshot" });
  });

  it("rejects a stale release even when the job runs early", () => {
    expect(
      planPublish({ ...approved, contentHash: "b".repeat(64) }, before(5000))
    ).toEqual({ kind: "reject", reason: "stale_snapshot" });
  });
});

describe("publishesOnApproval", () => {
  it("publishes in the approval itself once the time has come", () => {
    expect(publishesOnApproval(T, T)).toBe(true);
    expect(publishesOnApproval(T, after(1))).toBe(true);
  });

  it("leaves a future time to the scheduled job", () => {
    expect(publishesOnApproval(T, before(1))).toBe(false);
  });
});
