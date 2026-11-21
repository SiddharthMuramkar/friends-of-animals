import { describe, expect, it } from "vitest";

import {
  DONATION_EVENTS,
  DONATION_STATUSES,
  type DonationEvent,
  type DonationStatus,
  allocatesReceipt,
  initialDonationStatus,
  nextDonationStatus,
} from "./donation-status";

// Every allowed move. Anything not listed here is forbidden, and the
// exhaustive check below proves the table says so.
const ALLOWED: readonly [DonationStatus, DonationEvent, DonationStatus][] = [
  ["pending", "captured", "captured"],
  ["pending", "payment_failed", "failed"],
  ["pending", "checkout_expired", "expired"],
  ["pending", "foreign_captured", "refund_pending"],
  ["failed", "captured", "captured"],
  ["failed", "foreign_captured", "refund_pending"],
  ["captured", "refund_requested", "refund_pending"],
  ["refund_pending", "refund_processed_in_full", "refunded"],
  ["refund_pending", "refund_processed_in_part", "partially_refunded"],
  ["partially_refunded", "refund_requested", "refund_pending"],
];

const allowedKey = (from: DonationStatus, event: DonationEvent) =>
  `${from} --${event}-->`;
const allowedMoves = new Map(
  ALLOWED.map(([from, event, to]) => [allowedKey(from, event), to])
);

describe("the donation transition table", () => {
  it.each(ALLOWED)("%s --%s--> %s", (from, event, to) => {
    expect(nextDonationStatus(from, event)).toEqual({ ok: true, to });
  });

  const forbidden = DONATION_STATUSES.flatMap((from) =>
    DONATION_EVENTS.filter(
      (event) => !allowedMoves.has(allowedKey(from, event))
    ).map((event) => [from, event] as const)
  );

  it.each(forbidden)("refuses %s --%s-->", (from, event) => {
    expect(nextDonationStatus(from, event)).toEqual({
      ok: false,
      reason: "forbidden_transition",
      from,
      event,
    });
  });

  it("covers every status and event pair exactly once", () => {
    expect(ALLOWED.length + forbidden.length).toBe(
      DONATION_STATUSES.length * DONATION_EVENTS.length
    );
  });

  it.each([
    ["refunded is final", "refunded"],
    ["expired is final", "expired"],
  ] as const)("%s", (_, status) => {
    for (const event of DONATION_EVENTS) {
      expect(nextDonationStatus(status, event).ok).toBe(false);
    }
  });

  it("never lets an expired donation be captured without a new checkout", () => {
    expect(nextDonationStatus("expired", "captured").ok).toBe(false);
  });

  it("never turns a captured donation into a failed one", () => {
    expect(nextDonationStatus("captured", "payment_failed").ok).toBe(false);
  });

  it("refunds only through refund_pending", () => {
    expect(nextDonationStatus("pending", "refund_processed_in_full").ok).toBe(
      false
    );
    expect(nextDonationStatus("captured", "refund_processed_in_full").ok).toBe(
      false
    );
  });
});

describe("initialDonationStatus", () => {
  it("starts an online donation as pending", () => {
    expect(initialDonationStatus("online_checkout")).toBe("pending");
  });

  it.each(["offline_entry", "recurring_charge"] as const)(
    "starts a %s as captured",
    (source) => {
      expect(initialDonationStatus(source)).toBe("captured");
    }
  );
});

describe("allocatesReceipt", () => {
  it.each([
    ["pending", "captured"],
    ["failed", "captured"],
  ] as const)("allocates a number for %s --%s-->", (from, event) => {
    expect(allocatesReceipt(from, event)).toBe(true);
  });

  it("allocates a number when a donation is born captured", () => {
    expect(allocatesReceipt(null, "captured")).toBe(true);
  });

  it("allocates nothing for a foreign capture", () => {
    expect(allocatesReceipt("pending", "foreign_captured")).toBe(false);
  });

  it("allocates nothing for any other move", () => {
    const others = DONATION_STATUSES.flatMap((from) =>
      DONATION_EVENTS.map((event) => [from, event] as const)
    ).filter(
      ([from, event]) =>
        !(event === "captured" && (from === "pending" || from === "failed"))
    );
    for (const [from, event] of others) {
      expect(allocatesReceipt(from, event)).toBe(false);
    }
  });
});
