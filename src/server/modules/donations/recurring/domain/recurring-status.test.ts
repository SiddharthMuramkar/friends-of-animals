import { describe, expect, it } from "vitest";

import {
  INITIAL_RECURRING_STATUS,
  RECURRING_DONATION_EVENTS,
  RECURRING_DONATION_STATUSES,
  type RecurringDonationEvent,
  type RecurringDonationStatus,
  canCancelRecurring,
  isFinalRecurringStatus,
  nextRecurringStatus,
} from "./recurring-status";

// Every allowed move. Anything not listed here is forbidden, and the
// exhaustive check below proves the table says so.
const ALLOWED: readonly [
  RecurringDonationStatus,
  RecurringDonationEvent,
  RecurringDonationStatus,
][] = [
  ["pending_authorisation", "authorised", "active"],
  ["pending_authorisation", "charged", "active"],
  ["pending_authorisation", "cancelled", "cancelled"],
  ["pending_authorisation", "authorisation_expired", "cancelled"],
  ["active", "charged", "active"],
  ["active", "charge_failed", "past_due"],
  ["active", "retries_exhausted", "halted"],
  ["active", "cancelled", "cancelled"],
  ["active", "completed", "completed"],
  ["past_due", "charged", "active"],
  ["past_due", "authorised", "active"],
  ["past_due", "charge_failed", "past_due"],
  ["past_due", "retries_exhausted", "halted"],
  ["past_due", "cancelled", "cancelled"],
  ["halted", "authorised", "active"],
  ["halted", "charged", "active"],
  ["halted", "cancelled", "cancelled"],
];

const key = (from: RecurringDonationStatus, event: RecurringDonationEvent) =>
  `${from} --${event}-->`;
const allowedMoves = new Set(ALLOWED.map(([from, event]) => key(from, event)));

describe("the recurring-donation transition table", () => {
  it.each(ALLOWED)("%s --%s--> %s", (from, event, to) => {
    expect(nextRecurringStatus(from, event)).toEqual({ ok: true, to });
  });

  const forbidden = RECURRING_DONATION_STATUSES.flatMap((from) =>
    RECURRING_DONATION_EVENTS.filter(
      (event) => !allowedMoves.has(key(from, event))
    ).map((event) => [from, event] as const)
  );

  it.each(forbidden)("refuses %s --%s-->", (from, event) => {
    expect(nextRecurringStatus(from, event)).toEqual({
      ok: false,
      reason: "forbidden_transition",
      from,
      event,
    });
  });

  it("covers every status and event pair exactly once", () => {
    expect(ALLOWED.length + forbidden.length).toBe(
      RECURRING_DONATION_STATUSES.length * RECURRING_DONATION_EVENTS.length
    );
  });

  it.each(["cancelled", "completed"] as const)("%s is final", (status) => {
    for (const event of RECURRING_DONATION_EVENTS) {
      expect(nextRecurringStatus(status, event).ok).toBe(false);
    }
  });

  it("never revives a cancelled donation, even when a charge lands", () => {
    expect(nextRecurringStatus("cancelled", "charged").ok).toBe(false);
    expect(nextRecurringStatus("cancelled", "authorised").ok).toBe(false);
  });

  it("never revives a completed donation", () => {
    expect(nextRecurringStatus("completed", "authorised").ok).toBe(false);
  });

  it("only expires a mandate that was never authorised", () => {
    const expiring = RECURRING_DONATION_STATUSES.filter(
      (from) => nextRecurringStatus(from, "authorisation_expired").ok
    );
    expect(expiring).toEqual(["pending_authorisation"]);
  });

  it("follows the gateway when it revives a halted subscription", () => {
    expect(nextRecurringStatus("halted", "authorised")).toEqual({
      ok: true,
      to: "active",
    });
  });
});

describe("starting, ending and cancelling", () => {
  it("starts every recurring donation waiting for authorisation", () => {
    expect(INITIAL_RECURRING_STATUS).toBe("pending_authorisation");
  });

  it.each([
    ["pending_authorisation", false, true],
    ["active", false, true],
    ["past_due", false, true],
    ["halted", false, true],
    ["cancelled", true, false],
    ["completed", true, false],
  ] as const)("%s: final %s, cancellable %s", (status, final, cancellable) => {
    expect(isFinalRecurringStatus(status)).toBe(final);
    expect(canCancelRecurring(status)).toBe(cancellable);
  });

  it("lets every cancellable status reach cancelled", () => {
    for (const status of RECURRING_DONATION_STATUSES) {
      if (!canCancelRecurring(status)) continue;
      expect(nextRecurringStatus(status, "cancelled")).toEqual({
        ok: true,
        to: "cancelled",
      });
    }
  });
});
