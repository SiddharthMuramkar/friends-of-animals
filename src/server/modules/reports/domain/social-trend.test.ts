import { describe, expect, it } from "vitest";

import { resolvePeriod, type ResolvedPeriod } from "./period";
import type { SocialChannel } from "./social-snapshot";
import {
  socialTrend,
  summariseSocialPeriod,
  type SocialSnapshot,
} from "./social-trend";

const NOW = new Date("2027-01-15T04:30:00.000Z");

function period(from: string, to: string): ResolvedPeriod {
  const result = resolvePeriod({ kind: "range", from, to }, NOW);
  if (!result.ok) throw new Error(result.reason);
  return result.period;
}

function snap(
  channel: SocialChannel,
  recordedFor: string,
  followers: number,
  flows: Partial<
    Pick<SocialSnapshot, "posts" | "reach" | "impressions" | "engagements">
  > = {}
): SocialSnapshot {
  return {
    channel,
    recordedFor,
    followers,
    posts: 0,
    reach: null,
    impressions: null,
    engagements: null,
    ...flows,
  };
}

// The hand-computed fixture: Instagram monthly, YouTube twice, X once.
const FIXTURE: SocialSnapshot[] = [
  snap("youtube", "2026-12-20", 300, {
    posts: 2,
    reach: 2000,
    impressions: 5000,
    engagements: 400,
  }),
  snap("instagram", "2026-11-30", 1000, {
    posts: 8,
    reach: 6000,
    impressions: 9000,
    engagements: 700,
  }),
  snap("instagram", "2026-12-31", 1150, {
    posts: 10,
    reach: 8000,
    impressions: 12000,
    engagements: 900,
  }),
  snap("instagram", "2026-12-15", 1080, {
    posts: 4,
    reach: 3000,
    impressions: 4000,
    engagements: 300,
  }),
  snap("youtube", "2026-12-05", 280, { posts: 1 }),
  snap("x", "2027-01-05", 50, { posts: 3 }),
];

describe("summariseSocialPeriod", () => {
  const december = summariseSocialPeriod(
    FIXTURE,
    period("2026-12-01", "2026-12-31")
  );

  it("lists channels with a snapshot by the period's end, in display order", () => {
    expect(december.channels.map((row) => row.channel)).toEqual([
      "instagram",
      "youtube",
    ]);
  });

  it("measures followers from the last snapshot before the period", () => {
    expect(december.channels[0]).toMatchObject({
      channel: "instagram",
      snapshots: 2,
      followers: { current: 1150, previous: 1000, delta: 150, percent: 15 },
    });
  });

  it("measures from the first snapshot when none came before", () => {
    expect(december.channels[1]).toMatchObject({
      channel: "youtube",
      snapshots: 2,
      followers: { current: 300, previous: 280, delta: 20, percent: 7.1 },
    });
  });

  it("adds up activity dated inside the period only", () => {
    expect(december.channels[0]).toMatchObject({
      posts: { total: 14, missing: 0 },
      reach: { total: 11000, missing: 0 },
      impressions: { total: 16000, missing: 0 },
      engagements: { total: 1200, missing: 0 },
      engagementRate: 7.5,
    });
  });

  it("counts unreported figures instead of treating them as zero", () => {
    expect(december.channels[1]).toMatchObject({
      posts: { total: 3, missing: 0 },
      reach: { total: 2000, missing: 1 },
      impressions: { total: 5000, missing: 1 },
      engagements: { total: 400, missing: 1 },
      // A rate over part of the period would mislead, so there is none.
      engagementRate: null,
    });
  });

  it("totals every channel", () => {
    expect(december.total).toEqual({
      snapshots: 4,
      followers: { current: 1450, previous: 1280, delta: 170, percent: 13.3 },
      posts: { total: 17, missing: 0 },
      reach: { total: 13000, missing: 1 },
      impressions: { total: 21000, missing: 1 },
      engagements: { total: 1600, missing: 1 },
      engagementRate: null,
    });
  });

  it("carries the last known followers into a period with no snapshot", () => {
    const quiet = summariseSocialPeriod(
      FIXTURE,
      period("2027-01-01", "2027-01-04")
    );
    expect(quiet.channels.map((row) => [row.channel, row.snapshots])).toEqual([
      ["instagram", 0],
      ["youtube", 0],
    ]);
    expect(quiet.channels[0]).toMatchObject({
      followers: { current: 1150, previous: 1150, delta: 0 },
      posts: { total: null, missing: 0 },
      engagementRate: null,
    });
  });

  it("is empty before the first snapshot", () => {
    expect(
      summariseSocialPeriod(FIXTURE, period("2026-01-01", "2026-01-31"))
    ).toEqual({
      channels: [],
      total: {
        snapshots: 0,
        followers: null,
        posts: { total: null, missing: 0 },
        reach: { total: null, missing: 0 },
        impressions: { total: null, missing: 0 },
        engagements: { total: null, missing: 0 },
        engagementRate: null,
      },
    });
  });
});

describe("socialTrend", () => {
  it("summarises each bucket of the period, oldest first", () => {
    const trend = socialTrend(FIXTURE, period("2026-11-20", "2027-01-15"));
    expect(trend.granularity).toBe("week");
    expect(trend.buckets[0]).toMatchObject({
      from: "2026-11-20",
      to: "2026-11-22",
    });
    expect(trend.buckets.at(-1)).toMatchObject({
      from: "2027-01-11",
      to: "2027-01-15",
    });
    const totals = trend.buckets.map((bucket) => [
      bucket.from,
      bucket.total.followers?.current ?? null,
    ]);
    expect(totals).toEqual([
      ["2026-11-20", null],
      ["2026-11-23", null],
      ["2026-11-30", 1280],
      ["2026-12-07", 1280],
      ["2026-12-14", 1380],
      ["2026-12-21", 1380],
      ["2026-12-28", 1450],
      ["2027-01-04", 1500],
      ["2027-01-11", 1500],
    ]);
  });

  it("buckets a long period by month", () => {
    const trend = socialTrend(FIXTURE, period("2026-04-01", "2027-01-15"));
    expect(trend.granularity).toBe("month");
    expect(trend.buckets.map((bucket) => bucket.from)).toHaveLength(10);
    expect(trend.buckets.at(-2)).toMatchObject({
      from: "2026-12-01",
      total: { snapshots: 4, posts: { total: 17, missing: 0 } },
    });
  });
});
