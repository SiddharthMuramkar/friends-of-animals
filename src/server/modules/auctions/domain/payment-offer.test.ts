import { describe, expect, it } from "vitest";

import {
  OFFER_EVENTS,
  OFFER_STATUSES,
  decideOfferTransition,
  isOfferDue,
  offerExpiresAt,
} from "./payment-offer";

describe("decideOfferTransition", () => {
  const allowed: Record<string, string> = {
    "open:captured": "paid",
    "open:window_passed": "expired",
    "open:lot_withdrawn": "superseded",
  };

  it("allows only the three moves out of an open offer", () => {
    for (const from of OFFER_STATUSES) {
      for (const event of OFFER_EVENTS) {
        const to = allowed[`${from}:${event}`];
        expect(decideOfferTransition({ from, event })).toEqual(
          to ? { ok: true, to } : { ok: false, error: "transition_not_allowed" }
        );
      }
    }
  });
});

describe("offerExpiresAt", () => {
  it("ends the window the configured number of hours after the offer", () => {
    expect(
      offerExpiresAt(new Date("2027-01-15T04:30:00.000Z"), 72).toISOString()
    ).toBe("2027-01-18T04:30:00.000Z");
  });

  it("refuses a window outside 1 to 336 whole hours", () => {
    const at = new Date("2027-01-15T04:30:00.000Z");
    expect(() => offerExpiresAt(at, 0)).toThrow(RangeError);
    expect(() => offerExpiresAt(at, 337)).toThrow(RangeError);
    expect(() => offerExpiresAt(at, 1.5)).toThrow(RangeError);
  });
});

describe("isOfferDue", () => {
  const expiresAt = new Date("2027-01-18T04:30:00.000Z");

  it("is due from the deadline on, while the offer is open", () => {
    expect(
      isOfferDue(
        { status: "open", expiresAt },
        new Date("2027-01-18T04:29:59.999Z")
      )
    ).toBe(false);
    expect(isOfferDue({ status: "open", expiresAt }, expiresAt)).toBe(true);
    expect(
      isOfferDue(
        { status: "open", expiresAt },
        new Date("2027-01-19T00:00:00.000Z")
      )
    ).toBe(true);
  });

  it("is never due once the offer is paid, expired or superseded", () => {
    const late = new Date("2027-02-01T00:00:00.000Z");
    for (const status of ["paid", "expired", "superseded"] as const) {
      expect(isOfferDue({ status, expiresAt }, late)).toBe(false);
    }
  });
});
