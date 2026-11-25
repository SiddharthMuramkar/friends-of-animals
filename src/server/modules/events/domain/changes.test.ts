import { describe, expect, it } from "vitest";

import { eventChanges, type NoticeFields } from "./changes";

const before: NoticeFields = {
  startsAt: new Date("2027-02-13T01:30:00.000Z"),
  endsAt: new Date("2027-02-13T04:30:00.000Z"),
  venueName: "Juhu Beach, Gate 4",
  address: null,
  city: "Mumbai",
  pinCode: "400049",
  onlineUrl: null,
};

describe("eventChanges", () => {
  it("finds nothing to tell registrants when no time or place changed", () => {
    expect(eventChanges(before, { ...before })).toEqual({
      notice: [],
      startMoved: false,
    });
  });

  it("treats the same instant in a new Date object as unchanged", () => {
    expect(
      eventChanges(before, {
        ...before,
        startsAt: new Date(before.startsAt.getTime()),
      })
    ).toEqual({ notice: [], startMoved: false });
  });

  it("reports a moved start as a time change that moves reminders", () => {
    expect(
      eventChanges(before, {
        ...before,
        startsAt: new Date("2027-02-13T02:30:00.000Z"),
      })
    ).toEqual({ notice: ["time"], startMoved: true });
  });

  it("reports a new end as a time change that leaves reminders alone", () => {
    expect(
      eventChanges(before, {
        ...before,
        endsAt: new Date("2027-02-13T05:30:00.000Z"),
      })
    ).toEqual({ notice: ["time"], startMoved: false });
  });

  it.each([
    ["venueName", "Juhu Beach, Gate 7"],
    ["address", "Near the lifeguard tower"],
    ["city", "Navi Mumbai"],
    ["pinCode", "400050"],
    ["onlineUrl", "https://meet.example.test/foa"],
  ] as const)("reports a new %s as a place change", (field, value) => {
    expect(eventChanges(before, { ...before, [field]: value })).toEqual({
      notice: ["place"],
      startMoved: false,
    });
  });

  it("lists time before place when both changed", () => {
    expect(
      eventChanges(before, {
        ...before,
        startsAt: new Date("2027-02-14T01:30:00.000Z"),
        endsAt: new Date("2027-02-14T04:30:00.000Z"),
        venueName: "Versova Beach",
      })
    ).toEqual({ notice: ["time", "place"], startMoved: true });
  });
});
