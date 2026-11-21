import { describe, expect, it } from "vitest";

import {
  canMoveEvent,
  EVENT_KINDS,
  EVENT_STATUSES,
  EventTransitionError,
  moveEvent,
  type EventStatus,
} from "./event-status";

// Every allowed move, written out by hand so a change to the table in
// event-status.ts has to change this list too. Every other pair is
// forbidden.
const ALLOWED: ReadonlyArray<[EventStatus | null, EventStatus]> = [
  [null, "draft"],
  ["draft", "published"],
  ["draft", "cancelled"],
  ["published", "cancelled"],
  ["published", "completed"],
];

const key = (from: string | null, to: string) => `${from ?? "(new)"} -> ${to}`;
const allowed = new Set(ALLOWED.map(([from, to]) => key(from, to)));
const pairs = [null, ...EVENT_STATUSES].flatMap((from) =>
  EVENT_STATUSES.map((to) => [from, to] as const)
);

describe("event statuses", () => {
  it("has the four statuses and two kinds the schema enums are built from", () => {
    expect(EVENT_STATUSES).toEqual([
      "draft",
      "published",
      "cancelled",
      "completed",
    ]);
    expect(EVENT_KINDS).toEqual(["event", "campaign"]);
  });

  it.each(pairs.filter(([from, to]) => allowed.has(key(from, to))))(
    "allows %s -> %s",
    (from, to) => {
      expect(canMoveEvent(from, to)).toBe(true);
      expect(moveEvent(from, to)).toBe(to);
    }
  );

  it.each(pairs.filter(([from, to]) => !allowed.has(key(from, to))))(
    "forbids %s -> %s",
    (from, to) => {
      expect(canMoveEvent(from, to)).toBe(false);
      expect(() => moveEvent(from, to)).toThrow(EventTransitionError);
    }
  );

  it("names both ends of a forbidden move", () => {
    expect(() => moveEvent("cancelled", "published")).toThrow(
      "An event can't move from cancelled to published"
    );
    expect(() => moveEvent(null, "published")).toThrow(
      "An event can't move from (new) to published"
    );
  });

  it("keeps cancelled and completed final", () => {
    for (const to of EVENT_STATUSES) {
      expect(canMoveEvent("cancelled", to)).toBe(false);
      expect(canMoveEvent("completed", to)).toBe(false);
    }
  });
});
