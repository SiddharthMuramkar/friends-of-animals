import { describe, expect, it } from "vitest";

import { closeAfterBid, closeDue } from "./anti-sniping";

const CLOSES_AT = new Date("2027-02-01T12:30:00.000Z");

describe("closeAfterBid", () => {
  it("extends the close by the whole window for a bid one second inside it", () => {
    expect(
      closeAfterBid({
        closesAt: CLOSES_AT,
        placedAt: new Date("2027-02-01T12:25:01.000Z"),
        windowMinutes: 5,
      })
    ).toEqual({
      closesAt: new Date("2027-02-01T12:35:00.000Z"),
      extended: true,
    });
  });

  it("extends the close for a bid in the last second", () => {
    expect(
      closeAfterBid({
        closesAt: CLOSES_AT,
        placedAt: new Date("2027-02-01T12:29:59.999Z"),
        windowMinutes: 5,
      })
    ).toEqual({
      closesAt: new Date("2027-02-01T12:35:00.000Z"),
      extended: true,
    });
  });

  it("leaves the close alone for a bid exactly at the start of the window", () => {
    expect(
      closeAfterBid({
        closesAt: CLOSES_AT,
        placedAt: new Date("2027-02-01T12:25:00.000Z"),
        windowMinutes: 5,
      })
    ).toEqual({ closesAt: CLOSES_AT, extended: false });
  });

  it("leaves the close alone for an early bid", () => {
    expect(
      closeAfterBid({
        closesAt: CLOSES_AT,
        placedAt: new Date("2027-02-01T09:00:00.000Z"),
        windowMinutes: 5,
      })
    ).toEqual({ closesAt: CLOSES_AT, extended: false });
  });

  it("never extends when the window is zero (anti-sniping off)", () => {
    expect(
      closeAfterBid({
        closesAt: CLOSES_AT,
        placedAt: new Date("2027-02-01T12:29:59.000Z"),
        windowMinutes: 0,
      })
    ).toEqual({ closesAt: CLOSES_AT, extended: false });
  });

  it("extends again from the already extended close", () => {
    const first = closeAfterBid({
      closesAt: CLOSES_AT,
      placedAt: new Date("2027-02-01T12:29:00.000Z"),
      windowMinutes: 5,
    });
    const second = closeAfterBid({
      closesAt: first.closesAt,
      placedAt: new Date("2027-02-01T12:34:30.000Z"),
      windowMinutes: 5,
    });
    expect(second).toEqual({
      closesAt: new Date("2027-02-01T12:40:00.000Z"),
      extended: true,
    });
  });

  it("refuses a negative or fractional window", () => {
    expect(() =>
      closeAfterBid({
        closesAt: CLOSES_AT,
        placedAt: CLOSES_AT,
        windowMinutes: -1,
      })
    ).toThrow(RangeError);
    expect(() =>
      closeAfterBid({
        closesAt: CLOSES_AT,
        placedAt: CLOSES_AT,
        windowMinutes: 1.5,
      })
    ).toThrow(RangeError);
  });
});

describe("closeDue", () => {
  it("reschedules a close job that fires before an extended close", () => {
    expect(closeDue(CLOSES_AT, new Date("2027-02-01T12:29:59.000Z"))).toEqual({
      kind: "reschedule",
      at: CLOSES_AT,
    });
  });

  it("closes the lot at the closing instant", () => {
    expect(closeDue(CLOSES_AT, CLOSES_AT)).toEqual({ kind: "close" });
  });

  it("closes the lot when the job runs late", () => {
    expect(closeDue(CLOSES_AT, new Date("2027-02-01T13:00:00.000Z"))).toEqual({
      kind: "close",
    });
  });
});
