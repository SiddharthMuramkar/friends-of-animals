import { describe, expect, it } from "vitest";

import { overdueDigests, queueFlags, requestDueAt } from "./due";

const created = new Date("2027-01-15T04:30:00.000Z"); // 10:00 IST

describe("requestDueAt", () => {
  it("is the filing instant plus the due days", () => {
    expect(requestDueAt(created, 30)).toEqual(
      new Date("2027-02-14T04:30:00.000Z")
    );
  });

  it("refuses a due period that isn't a positive whole number of days", () => {
    expect(() => requestDueAt(created, 0)).toThrow(RangeError);
    expect(() => requestDueAt(created, 2.5)).toThrow(RangeError);
  });
});

describe("queueFlags", () => {
  const dueAt = new Date("2027-02-14T04:30:00.000Z"); // 14 Feb, 10:00 IST

  it("counts days left on India's calendar", () => {
    expect(queueFlags({ status: "submitted", dueAt, now: created })).toEqual({
      open: true,
      overdue: false,
      daysLeft: 30,
    });
    // 13 Feb, 23:59 IST: one calendar day to go.
    expect(
      queueFlags({
        status: "in_progress",
        dueAt,
        now: new Date("2027-02-13T18:29:00.000Z"),
      })
    ).toEqual({ open: true, overdue: false, daysLeft: 1 });
    // 14 Feb, 00:01 IST: due today.
    expect(
      queueFlags({
        status: "in_progress",
        dueAt,
        now: new Date("2027-02-13T18:31:00.000Z"),
      }).daysLeft
    ).toBe(0);
  });

  it("flags an open request overdue the moment its due instant passes", () => {
    expect(queueFlags({ status: "submitted", dueAt, now: dueAt }).overdue).toBe(
      false
    );
    expect(
      queueFlags({
        status: "submitted",
        dueAt,
        now: new Date(dueAt.getTime() + 1),
      })
    ).toEqual({ open: true, overdue: true, daysLeft: 0 });
    expect(
      queueFlags({
        status: "in_progress",
        dueAt,
        now: new Date("2027-02-17T04:30:00.000Z"),
      })
    ).toEqual({ open: true, overdue: true, daysLeft: -3 });
  });

  it("never flags a closed request, however late", () => {
    const late = new Date("2027-03-30T00:00:00.000Z");
    for (const status of [
      "completed",
      "partially_completed",
      "rejected",
      "cancelled",
    ] as const) {
      expect(queueFlags({ status, dueAt, now: late })).toEqual({
        open: false,
        overdue: false,
        daysLeft: null,
      });
    }
  });
});

describe("overdueDigests", () => {
  const now = new Date("2027-02-20T03:30:00.000Z");
  const past = new Date("2027-02-14T04:30:00.000Z");
  const future = new Date("2027-02-25T04:30:00.000Z");
  const asha = "0190a000-0000-7000-8000-000000000001";
  const ravi = "0190a000-0000-7000-8000-000000000002";

  it("gives each officer the overdue count and how many are theirs", () => {
    expect(
      overdueDigests({
        now,
        officerIds: [asha, ravi],
        requests: [
          { status: "submitted", dueAt: past, assignedToUserId: null },
          { status: "in_progress", dueAt: past, assignedToUserId: asha },
          { status: "in_progress", dueAt: future, assignedToUserId: ravi },
          { status: "completed", dueAt: past, assignedToUserId: ravi },
        ],
      })
    ).toEqual([
      { userId: asha, overdue: 2, assignedToYou: 1 },
      { userId: ravi, overdue: 2, assignedToYou: 0 },
    ]);
  });

  it("sends nothing when nothing is overdue", () => {
    expect(
      overdueDigests({
        now,
        officerIds: [asha],
        requests: [
          { status: "submitted", dueAt: future, assignedToUserId: null },
          { status: "rejected", dueAt: past, assignedToUserId: asha },
        ],
      })
    ).toEqual([]);
  });
});
