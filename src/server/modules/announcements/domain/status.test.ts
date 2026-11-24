import { describe, expect, it } from "vitest";

import {
  ANNOUNCEMENT_STATUSES,
  canMoveAnnouncement,
  isAnnouncementEditable,
  type AnnouncementStatus,
} from "./status";

const ALLOWED: ReadonlyArray<[AnnouncementStatus, AnnouncementStatus]> = [
  ["draft", "sent"],
];

const EVERY_MOVE = ANNOUNCEMENT_STATUSES.flatMap((from) =>
  ANNOUNCEMENT_STATUSES.map((to) => [from, to] as const)
);

const FORBIDDEN = EVERY_MOVE.filter(
  ([from, to]) => !ALLOWED.some(([a, b]) => a === from && b === to)
);

describe("canMoveAnnouncement()", () => {
  it("knows the two statuses an announcement can have", () => {
    expect(ANNOUNCEMENT_STATUSES).toEqual(["draft", "sent"]);
  });

  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canMoveAnnouncement(from, to)).toBe(true);
  });

  it.each(FORBIDDEN)("refuses %s -> %s", (from, to) => {
    expect(canMoveAnnouncement(from, to)).toBe(false);
  });

  it("covers every pair of statuses exactly once", () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(4);
    expect(FORBIDDEN).toContainEqual(["sent", "draft"]);
    expect(FORBIDDEN).toContainEqual(["sent", "sent"]);
  });
});

describe("isAnnouncementEditable()", () => {
  it("lets a manager edit only a draft", () => {
    expect(isAnnouncementEditable("draft")).toBe(true);
    expect(isAnnouncementEditable("sent")).toBe(false);
  });
});
