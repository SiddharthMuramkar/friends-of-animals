import { describe, expect, it } from "vitest";

import {
  approvedMinutes,
  canTransitionHours,
  checkHoursDecision,
  checkHoursEntry,
  hoursApprovedSourceKey,
  istDate,
  minutesLoggedOn,
  splitMinutes,
  VOLUNTEER_HOURS_STATUSES,
  type VolunteerHoursStatus,
} from "./hours";

describe("volunteer hours statuses", () => {
  it("declares every status the schema's enum needs, in order", () => {
    expect(VOLUNTEER_HOURS_STATUSES).toEqual([
      "submitted",
      "approved",
      "rejected",
    ]);
  });

  // Written out by hand: hours are logged as submitted, and a community
  // manager approves or rejects them once, for good.
  const ALLOWED: readonly (readonly [
    VolunteerHoursStatus | null,
    VolunteerHoursStatus,
  ])[] = [
    [null, "submitted"],
    ["submitted", "approved"],
    ["submitted", "rejected"],
  ];
  const FROM = [null, ...VOLUNTEER_HOURS_STATUSES] as const;

  it.each(
    FROM.flatMap((from) =>
      VOLUNTEER_HOURS_STATUSES.map((to) => [from, to] as const)
    )
  )("%s -> %s follows the table", (from, to) => {
    const allowed = ALLOWED.some(([f, t]) => f === from && t === to);
    expect(canTransitionHours(from, to)).toBe(allowed);
  });
});

describe("istDate", () => {
  it("reads the calendar date in India, which is UTC+05:30", () => {
    expect(istDate(new Date("2027-01-15T18:29:00.000Z"))).toBe("2027-01-15");
    expect(istDate(new Date("2027-01-15T18:30:00.000Z"))).toBe("2027-01-16");
    expect(istDate(new Date("2026-12-31T18:31:00.000Z"))).toBe("2027-01-01");
  });
});

describe("checkHoursEntry", () => {
  // 10:00 IST on 15 January 2027; assigned on 10 January.
  const base = {
    minutes: 90,
    workedOn: "2027-01-14",
    note: "Sorted the poster entries",
    taskStatus: "in_progress",
    assignment: {
      assignedAt: new Date("2027-01-10T05:00:00.000Z"),
      unassignedAt: null,
    },
    now: new Date("2027-01-15T04:30:00.000Z"),
    minutesLoggedThatDay: 0,
  } as const;

  it("accepts hours on an assigned task", () => {
    expect(checkHoursEntry(base)).toEqual({ ok: true });
  });

  it("accepts hours with no note", () => {
    expect(checkHoursEntry({ ...base, note: undefined })).toEqual({
      ok: true,
    });
  });

  it("refuses a volunteer who was never assigned", () => {
    expect(checkHoursEntry({ ...base, assignment: null })).toEqual({
      ok: false,
      problem: "not_assigned",
    });
  });

  it.each([
    ["draft", false],
    ["open", false],
    ["assigned", true],
    ["in_progress", true],
    ["done", true],
    ["cancelled", false],
  ] as const)("on a %s task: accepted %s", (taskStatus, accepted) => {
    expect(checkHoursEntry({ ...base, taskStatus })).toEqual(
      accepted
        ? { ok: true }
        : { ok: false, problem: "task_not_accepting_hours" }
    );
  });

  it.each([
    [1, true],
    [1440, true],
    [0, false],
    [-30, false],
    [1441, false],
    [30.5, false],
    [Number.NaN, false],
  ])("%d minutes: accepted %s", (minutes, accepted) => {
    expect(checkHoursEntry({ ...base, minutes })).toEqual(
      accepted ? { ok: true } : { ok: false, problem: "minutes_out_of_range" }
    );
  });

  it("allows a note of 500 characters, not 501", () => {
    expect(checkHoursEntry({ ...base, note: "a".repeat(500) })).toEqual({
      ok: true,
    });
    expect(checkHoursEntry({ ...base, note: "a".repeat(501) })).toEqual({
      ok: false,
      problem: "note_too_long",
    });
  });

  it("counts a note's characters, not its UTF-16 units, after trimming", () => {
    // An emoji is one character but two UTF-16 units.
    expect(checkHoursEntry({ ...base, note: "😀".repeat(500) })).toEqual({
      ok: true,
    });
    expect(
      checkHoursEntry({ ...base, note: `  ${"a".repeat(500)}  ` })
    ).toEqual({ ok: true });
  });

  it.each(["2027-02-30", "2027-1-14", "14-01-2027", "", "2027-13-01"])(
    "refuses the date %j",
    (workedOn) => {
      expect(checkHoursEntry({ ...base, workedOn })).toEqual({
        ok: false,
        problem: "worked_on_invalid",
      });
    }
  );

  it("accepts today and refuses tomorrow, on India's calendar", () => {
    // 23:59 IST on the 15th: the 15th is today, the 16th is not yet.
    const lateEvening = new Date("2027-01-15T18:29:00.000Z");
    expect(
      checkHoursEntry({ ...base, now: lateEvening, workedOn: "2027-01-15" })
    ).toEqual({ ok: true });
    expect(
      checkHoursEntry({ ...base, now: lateEvening, workedOn: "2027-01-16" })
    ).toEqual({ ok: false, problem: "worked_on_in_future" });
    // 00:01 IST on the 16th: now it is today.
    const justAfterMidnight = new Date("2027-01-15T18:31:00.000Z");
    expect(
      checkHoursEntry({
        ...base,
        now: justAfterMidnight,
        workedOn: "2027-01-16",
      })
    ).toEqual({ ok: true });
  });

  it("refuses a day before the assignment, on India's calendar", () => {
    // Assigned at 01:00 IST on 10 January (19:30Z on the 9th).
    const assignment = {
      assignedAt: new Date("2027-01-09T19:30:00.000Z"),
      unassignedAt: null,
    };
    expect(
      checkHoursEntry({ ...base, assignment, workedOn: "2027-01-10" })
    ).toEqual({ ok: true });
    expect(
      checkHoursEntry({ ...base, assignment, workedOn: "2027-01-09" })
    ).toEqual({ ok: false, problem: "before_assignment" });
  });

  it("accepts the day of unassignment and refuses the days after", () => {
    const assignment = {
      assignedAt: new Date("2027-01-05T05:00:00.000Z"),
      unassignedAt: new Date("2027-01-12T10:00:00.000Z"),
    };
    expect(
      checkHoursEntry({ ...base, assignment, workedOn: "2027-01-12" })
    ).toEqual({ ok: true });
    expect(
      checkHoursEntry({ ...base, assignment, workedOn: "2027-01-13" })
    ).toEqual({ ok: false, problem: "after_unassignment" });
  });

  it("keeps a day's hours at 24 at most", () => {
    expect(
      checkHoursEntry({ ...base, minutes: 60, minutesLoggedThatDay: 1380 })
    ).toEqual({ ok: true });
    expect(
      checkHoursEntry({ ...base, minutes: 61, minutesLoggedThatDay: 1380 })
    ).toEqual({ ok: false, problem: "day_limit_exceeded" });
  });

  it("reports not being assigned before anything else", () => {
    expect(
      checkHoursEntry({
        ...base,
        assignment: null,
        taskStatus: "cancelled",
        minutes: 0,
      })
    ).toEqual({ ok: false, problem: "not_assigned" });
  });
});

describe("minutesLoggedOn", () => {
  it("adds the day's submitted and approved hours, not rejected ones", () => {
    const entries = [
      { workedOn: "2027-01-14", minutes: 60, status: "submitted" },
      { workedOn: "2027-01-14", minutes: 30, status: "approved" },
      { workedOn: "2027-01-14", minutes: 600, status: "rejected" },
      { workedOn: "2027-01-13", minutes: 45, status: "approved" },
    ] as const;
    expect(minutesLoggedOn(entries, "2027-01-14")).toBe(90);
    expect(minutesLoggedOn(entries, "2027-01-12")).toBe(0);
  });
});

describe("approvedMinutes", () => {
  it("counts approved hours only", () => {
    expect(
      approvedMinutes([
        { minutes: 90, status: "approved" },
        { minutes: 45, status: "submitted" },
        { minutes: 120, status: "rejected" },
        { minutes: 30, status: "approved" },
      ])
    ).toBe(120);
  });

  it("is zero with nothing approved", () => {
    expect(approvedMinutes([])).toBe(0);
    expect(approvedMinutes([{ minutes: 60, status: "submitted" }])).toBe(0);
  });
});

describe("splitMinutes", () => {
  it.each([
    [0, { hours: 0, minutes: 0 }],
    [59, { hours: 0, minutes: 59 }],
    [60, { hours: 1, minutes: 0 }],
    [750, { hours: 12, minutes: 30 }],
  ])("%d minutes -> %o", (total, parts) => {
    expect(splitMinutes(total)).toEqual(parts);
  });

  it("refuses a negative or fractional total", () => {
    expect(() => splitMinutes(-1)).toThrow(RangeError);
    expect(() => splitMinutes(1.5)).toThrow(RangeError);
  });
});

describe("checkHoursDecision", () => {
  const base = {
    status: "submitted",
    volunteerUserId: "volunteer-1",
    deciderUserId: "manager-1",
  } as const;

  it("approves submitted hours", () => {
    expect(
      checkHoursDecision({ ...base, decision: { kind: "approve" } })
    ).toEqual({ ok: true, to: "approved", reason: null });
  });

  it("rejects submitted hours with the reason trimmed", () => {
    expect(
      checkHoursDecision({
        ...base,
        decision: { kind: "reject", reason: "  Logged twice  " },
      })
    ).toEqual({ ok: true, to: "rejected", reason: "Logged twice" });
  });

  it("refuses deciding your own hours, even as a community manager", () => {
    expect(
      checkHoursDecision({
        ...base,
        deciderUserId: "volunteer-1",
        decision: { kind: "approve" },
      })
    ).toEqual({ ok: false, problem: "own_hours" });
  });

  it.each(["approved", "rejected"] as const)(
    "refuses deciding %s hours again",
    (status) => {
      expect(
        checkHoursDecision({ ...base, status, decision: { kind: "approve" } })
      ).toEqual({ ok: false, problem: "already_decided" });
    }
  );

  it("needs a reason to reject", () => {
    expect(
      checkHoursDecision({
        ...base,
        decision: { kind: "reject", reason: "  " },
      })
    ).toEqual({ ok: false, problem: "reason_required" });
  });

  it("keeps a reason to 500 characters", () => {
    expect(
      checkHoursDecision({
        ...base,
        decision: { kind: "reject", reason: "a".repeat(500) },
      })
    ).toMatchObject({ ok: true });
    expect(
      checkHoursDecision({
        ...base,
        decision: { kind: "reject", reason: "a".repeat(501) },
      })
    ).toEqual({ ok: false, problem: "reason_too_long" });
  });

  it("reports own hours before the entry's state", () => {
    expect(
      checkHoursDecision({
        ...base,
        status: "approved",
        deciderUserId: "volunteer-1",
        decision: { kind: "approve" },
      })
    ).toEqual({ ok: false, problem: "own_hours" });
  });
});

describe("hoursApprovedSourceKey", () => {
  it("names the entry, so a replay writes one timeline entry", () => {
    expect(hoursApprovedSourceKey("0194a3c0-0000-7000-8000-000000000001")).toBe(
      "volunteer.hours_approved:0194a3c0-0000-7000-8000-000000000001"
    );
  });
});
