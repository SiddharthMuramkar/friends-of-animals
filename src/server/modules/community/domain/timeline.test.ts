import { describe, expect, it } from "vitest";

import { MILESTONE_KINDS } from "./milestones";
import {
  TIMELINE_CATEGORIES,
  TIMELINE_ENTRY_KINDS,
  groupTimelineByYear,
  isTimelineEntryKind,
  timelineCategory,
  timelineKindForMilestone,
} from "./timeline";

describe("timeline entry kinds", () => {
  it("sorts the journey into the issue's four kinds plus community", () => {
    expect([...TIMELINE_CATEGORIES]).toEqual([
      "competition",
      "recognition",
      "community",
      "event",
      "volunteering",
    ]);
  });

  it.each([
    ["participant", "milestone.participant", "competition"],
    ["school_winner", "milestone.school_winner", "recognition"],
    ["foa_finalist", "milestone.foa_finalist", "recognition"],
    ["community_member", "milestone.community_member", "community"],
    ["volunteer", "milestone.volunteer", "volunteering"],
    ["ambassador", "milestone.ambassador", "recognition"],
  ] as const)(
    "a %s milestone is a %s entry (%s)",
    (milestone, kind, category) => {
      expect(timelineKindForMilestone(milestone)).toBe(kind);
      expect(timelineCategory(kind)).toBe(category);
    }
  );

  it("registers an entry kind for every milestone", () => {
    for (const milestone of MILESTONE_KINDS) {
      expect(isTimelineEntryKind(timelineKindForMilestone(milestone))).toBe(
        true
      );
    }
    expect(Object.keys(TIMELINE_ENTRY_KINDS)).toHaveLength(
      MILESTONE_KINDS.length
    );
  });

  it("knows only registered kinds", () => {
    expect(isTimelineEntryKind("milestone.participant")).toBe(true);
    expect(isTimelineEntryKind("milestone.unknown")).toBe(false);
    expect(isTimelineEntryKind("toString")).toBe(false);
  });
});

describe("groupTimelineByYear", () => {
  const entry = (id: string, occurredAt: string) => ({
    id,
    occurredAt: new Date(occurredAt),
  });

  it("returns nothing for an empty timeline", () => {
    expect(groupTimelineByYear([])).toEqual([]);
  });

  it("orders oldest first, breaking ties by id, and groups by IST year", () => {
    const entries = [
      entry("0190a000-0000-7000-8000-00000000000d", "2027-03-01T10:00:00Z"),
      entry("0190a000-0000-7000-8000-00000000000b", "2026-06-01T10:00:00Z"),
      entry("0190a000-0000-7000-8000-00000000000c", "2026-06-01T10:00:00Z"),
      entry("0190a000-0000-7000-8000-00000000000a", "2026-06-01T10:00:00Z"),
    ];
    expect(
      groupTimelineByYear(entries).map((group) => ({
        year: group.year,
        ids: group.entries.map((e) => e.id.slice(-1)),
      }))
    ).toEqual([
      { year: 2026, ids: ["a", "b", "c"] },
      { year: 2027, ids: ["d"] },
    ]);
  });

  it("puts the last evening of December in IST into the new year", () => {
    // 18:30 UTC on 31 December is midnight in India.
    const groups = groupTimelineByYear([
      entry("0190a000-0000-7000-8000-000000000001", "2026-12-31T18:29:59Z"),
      entry("0190a000-0000-7000-8000-000000000002", "2026-12-31T18:30:00Z"),
    ]);
    expect(groups.map((group) => group.year)).toEqual([2026, 2027]);
  });

  it("leaves the caller's array as it was", () => {
    const entries = [
      entry("0190a000-0000-7000-8000-000000000002", "2027-01-01T00:00:00Z"),
      entry("0190a000-0000-7000-8000-000000000001", "2026-01-01T00:00:00Z"),
    ];
    groupTimelineByYear(entries);
    expect(entries.map((e) => e.id.slice(-1))).toEqual(["2", "1"]);
  });
});
