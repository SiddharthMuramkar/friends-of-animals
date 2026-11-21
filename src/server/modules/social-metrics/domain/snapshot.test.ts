import { describe, expect, it } from "vitest";

import { MAX_METRIC, SOCIAL_CHANNELS, socialSnapshotInput } from "./snapshot";

// 10:00 IST on 15 January 2027.
const NOW = new Date("2027-01-15T04:30:00.000Z");

const VALID = {
  channel: "instagram",
  recordedFor: "2027-01-15",
  followers: 1520,
  posts: 12,
  reach: 9800,
  impressions: 15400,
  engagements: 1100,
};

function issues(input: unknown, now = NOW) {
  const result = socialSnapshotInput(now).safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
}

describe("socialSnapshotInput", () => {
  it("lists the six channels in display order", () => {
    expect(SOCIAL_CHANNELS).toEqual([
      "instagram",
      "facebook",
      "youtube",
      "x",
      "linkedin",
      "other",
    ]);
  });

  it("accepts a full snapshot dated today", () => {
    expect(socialSnapshotInput(NOW).parse(VALID)).toEqual(VALID);
  });

  it("accepts reach, impressions and engagements left unreported", () => {
    const input = {
      ...VALID,
      reach: null,
      impressions: null,
      engagements: null,
    };
    expect(socialSnapshotInput(NOW).parse(input)).toEqual(input);
  });

  it("accepts zero and the largest count a column holds", () => {
    expect(issues({ ...VALID, followers: 0, posts: 0 })).toEqual([]);
    expect(issues({ ...VALID, reach: MAX_METRIC })).toEqual([]);
  });

  it("refuses a day after today in IST", () => {
    expect(issues({ ...VALID, recordedFor: "2027-01-16" })).toEqual([
      { path: "recordedFor", message: "in_future" },
    ]);
    // 23:59 IST on the 15th is still the 15th; 00:00 IST is the 16th.
    expect(
      issues(
        { ...VALID, recordedFor: "2027-01-16" },
        new Date("2027-01-15T18:30:00.000Z")
      )
    ).toEqual([]);
  });

  it.each([
    ["followers", -1],
    ["posts", 1.5],
    ["reach", MAX_METRIC + 1],
    ["impressions", "100"],
    ["engagements", Number.NaN],
  ])("refuses %s = %j", (field, value) => {
    expect(issues({ ...VALID, [field]: value })).toHaveLength(1);
    expect(issues({ ...VALID, [field]: value })[0]?.path).toBe(field);
  });

  it("requires followers and posts", () => {
    expect(issues({ ...VALID, followers: null }).map((i) => i.path)).toEqual([
      "followers",
    ]);
    const { posts: _posts, ...withoutPosts } = VALID;
    expect(issues(withoutPosts).map((i) => i.path)).toEqual(["posts"]);
  });

  it("refuses an unknown channel, a malformed day or an extra field", () => {
    expect(issues({ ...VALID, channel: "tiktok" })).toHaveLength(1);
    expect(issues({ ...VALID, recordedFor: "2027-02-30" })).toHaveLength(1);
    expect(issues({ ...VALID, recordedFor: "15/01/2027" })).toHaveLength(1);
    expect(issues({ ...VALID, recordedBy: "someone" })).toHaveLength(1);
  });
});
