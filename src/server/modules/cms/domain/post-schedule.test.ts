import { describe, expect, it } from "vitest";

import { checkPublishAt, decideScheduledPublish } from "./post-schedule";

const NOW = new Date("2027-01-15T04:30:00.000Z");
const T = new Date("2027-01-20T03:30:00.000Z"); // 09:00 IST, 20 Jan

describe("checkPublishAt", () => {
  it("accepts an instant after now", () => {
    expect(checkPublishAt(T, NOW)).toEqual({ ok: true });
    expect(checkPublishAt(new Date(NOW.getTime() + 1), NOW)).toEqual({
      ok: true,
    });
  });

  it("refuses now and the past", () => {
    expect(checkPublishAt(NOW, NOW)).toEqual({
      ok: false,
      refusal: "not_in_future",
    });
    expect(checkPublishAt(new Date("2027-01-14T00:00:00.000Z"), NOW)).toEqual({
      ok: false,
      refusal: "not_in_future",
    });
  });

  it("refuses an invalid date", () => {
    expect(checkPublishAt(new Date("not a date"), NOW)).toEqual({
      ok: false,
      refusal: "invalid_instant",
    });
  });
});

describe("decideScheduledPublish", () => {
  const job = { publishAt: T };

  it("publishes a scheduled post at its instant, dated to that instant", () => {
    expect(
      decideScheduledPublish({ status: "scheduled", publishAt: T }, job, T)
    ).toEqual({ action: "publish", publishedAt: T });
  });

  it("dates a late run to the scheduled instant, not the run time", () => {
    const late = new Date(T.getTime() + 15 * 60_000);
    expect(
      decideScheduledPublish({ status: "scheduled", publishAt: T }, job, late)
    ).toEqual({ action: "publish", publishedAt: T });
  });

  it("waits when the job comes due before the post's instant", () => {
    const early = new Date(T.getTime() - 60_000);
    expect(
      decideScheduledPublish({ status: "scheduled", publishAt: T }, job, early)
    ).toEqual({ action: "wait", until: T });
  });

  it("does nothing for a post that was unscheduled, published or archived", () => {
    for (const status of ["draft", "published", "archived"] as const) {
      expect(decideScheduledPublish({ status, publishAt: T }, job, T)).toEqual({
        action: "skip",
        reason: "not_scheduled",
      });
    }
  });

  it("leaves a rescheduled post to the job for its new instant", () => {
    const moved = new Date(T.getTime() + 24 * 3_600_000);
    expect(
      decideScheduledPublish({ status: "scheduled", publishAt: moved }, job, T)
    ).toEqual({ action: "skip", reason: "rescheduled" });

    const earlier = new Date(T.getTime() - 24 * 3_600_000);
    expect(
      decideScheduledPublish(
        { status: "scheduled", publishAt: earlier },
        job,
        T
      )
    ).toEqual({ action: "skip", reason: "rescheduled" });
  });

  it("publishes once when a post is rescheduled twice", () => {
    const first = { publishAt: T };
    const second = { publishAt: new Date(T.getTime() + 3_600_000) };
    const post = { status: "scheduled" as const, publishAt: second.publishAt };
    const at = second.publishAt;

    const decisions = [first, second].map((due) =>
      decideScheduledPublish(post, due, at)
    );

    expect(decisions.filter((d) => d.action === "publish")).toHaveLength(1);
  });

  it("treats a scheduled post with no instant as rescheduled", () => {
    expect(
      decideScheduledPublish({ status: "scheduled", publishAt: null }, job, T)
    ).toEqual({ action: "skip", reason: "rescheduled" });
  });
});
