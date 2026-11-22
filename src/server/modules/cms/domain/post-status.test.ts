import { describe, expect, it } from "vitest";

import {
  POST_STATUSES,
  canEditPost,
  isPostPublic,
  nextPostStatus,
  type PostStatus,
  type PostTrigger,
} from "./post-status";

describe("nextPostStatus", () => {
  it.each<[PostStatus | null, PostTrigger, PostStatus]>([
    [null, "create", "draft"],
    ["draft", "schedule", "scheduled"],
    ["draft", "publish", "published"],
    ["scheduled", "reschedule", "scheduled"],
    ["scheduled", "scheduled_publish", "published"],
    ["scheduled", "unschedule", "draft"],
    ["scheduled", "publish", "published"],
    ["published", "archive", "archived"],
    ["archived", "restore", "draft"],
  ])("moves %s on %s to %s", (from, trigger, to) => {
    expect(nextPostStatus(from, trigger)).toBe(to);
  });

  it.each<[PostStatus | null, PostTrigger]>([
    // The forbidden moves the post lifecycle names.
    ["scheduled", "archive"],
    ["archived", "publish"],
    ["draft", "archive"],
    // A published post goes away only by archiving.
    ["published", "unschedule"],
    ["published", "schedule"],
    ["published", "publish"],
    // The job only ever publishes a scheduled post.
    ["draft", "scheduled_publish"],
    ["published", "scheduled_publish"],
    ["archived", "scheduled_publish"],
    // Rescheduling needs a schedule to change.
    ["draft", "reschedule"],
    ["archived", "schedule"],
    // A post is created once.
    ["draft", "create"],
    [null, "publish"],
    [null, "schedule"],
  ])("refuses %s on %s", (from, trigger) => {
    expect(nextPostStatus(from, trigger)).toBeNull();
  });

  it("knows the four statuses, in lifecycle order", () => {
    expect(POST_STATUSES).toEqual([
      "draft",
      "scheduled",
      "published",
      "archived",
    ]);
  });
});

describe("canEditPost", () => {
  it.each<[PostStatus, boolean]>([
    ["draft", true],
    ["scheduled", true],
    ["published", true],
    ["archived", false],
  ])("%s: %s", (status, editable) => {
    expect(canEditPost(status)).toBe(editable);
  });
});

describe("isPostPublic", () => {
  const now = new Date("2027-01-15T04:30:00.000Z");
  const earlier = new Date("2027-01-15T04:00:00.000Z");
  const later = new Date("2027-01-15T05:00:00.000Z");

  it("shows a published post from its publish instant", () => {
    expect(
      isPostPublic({ status: "published", publishedAt: earlier }, now)
    ).toBe(true);
    expect(isPostPublic({ status: "published", publishedAt: now }, now)).toBe(
      true
    );
  });

  it("shows a scheduled post from its instant, before the job has run", () => {
    expect(isPostPublic({ status: "scheduled", publishAt: earlier }, now)).toBe(
      true
    );
    expect(isPostPublic({ status: "scheduled", publishAt: now }, now)).toBe(
      true
    );
    expect(isPostPublic({ status: "scheduled", publishAt: later }, now)).toBe(
      false
    );
  });

  it("never shows a draft or an archived post", () => {
    for (const status of ["draft", "archived"] as const) {
      expect(
        isPostPublic({ status, publishedAt: earlier, publishAt: earlier }, now)
      ).toBe(false);
    }
  });

  it("hides a post whose instant is still ahead or missing", () => {
    expect(isPostPublic({ status: "published", publishedAt: later }, now)).toBe(
      false
    );
    expect(isPostPublic({ status: "published", publishedAt: null }, now)).toBe(
      false
    );
    expect(isPostPublic({ status: "scheduled", publishAt: null }, now)).toBe(
      false
    );
  });
});
