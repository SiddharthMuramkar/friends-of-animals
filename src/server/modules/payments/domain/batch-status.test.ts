import { describe, expect, it } from "vitest";

import {
  holdsRegistrations,
  nextPaymentBatchStatus,
  PAYMENT_BATCH_EVENTS,
  PAYMENT_BATCH_STATUSES,
  type PaymentBatchEvent,
  type PaymentBatchStatus,
} from "./batch-status";

/** Every allowed move. Each other status and event pair is forbidden. */
const ALLOWED: ReadonlyArray<
  [PaymentBatchStatus, PaymentBatchEvent, PaymentBatchStatus]
> = [
  ["created", "order_opened", "order_created"],
  ["created", "order_refused", "failed"],
  ["created", "superseded", "cancelled"],
  ["order_created", "captured", "captured"],
  ["order_created", "superseded", "cancelled"],
  // Offline payments and the review of captures that can't be accepted
  // (#79). A created batch has no order yet, so no capture can reach it.
  ["created", "offline_recorded", "captured"],
  ["order_created", "offline_recorded", "captured"],
  ["order_created", "review_opened", "needs_review"],
  ["failed", "review_opened", "needs_review"],
  ["cancelled", "review_opened", "needs_review"],
  ["needs_review", "review_opened", "needs_review"],
  ["needs_review", "review_confirmed", "captured"],
  ["needs_review", "review_cleared", "captured"],
  ["needs_review", "review_dismissed", "cancelled"],
];

const allowedTo = (from: PaymentBatchStatus, event: PaymentBatchEvent) =>
  ALLOWED.find(([f, e]) => f === from && e === event)?.[2];

const EVERY_PAIR = PAYMENT_BATCH_STATUSES.flatMap((from) =>
  PAYMENT_BATCH_EVENTS.map((event) => [from, event] as const)
);

describe("nextPaymentBatchStatus()", () => {
  it.each(ALLOWED)("moves %s on %s to %s", (from, event, to) => {
    expect(nextPaymentBatchStatus(from, event)).toEqual({ ok: true, to });
  });

  it.each(EVERY_PAIR.filter(([from, event]) => !allowedTo(from, event)))(
    "refuses %s on %s",
    (from, event) => {
      expect(nextPaymentBatchStatus(from, event)).toEqual({
        ok: false,
        reason: "forbidden_transition",
        from,
        event,
      });
    }
  );

  it("covers every status and event pair exactly once", () => {
    const allowed = EVERY_PAIR.filter(([f, e]) => allowedTo(f, e)).length;
    expect(allowed).toBe(ALLOWED.length);
    expect(EVERY_PAIR).toHaveLength(
      PAYMENT_BATCH_STATUSES.length * PAYMENT_BATCH_EVENTS.length
    );
  });

  it("never moves a captured batch: a second payment's case opens beside it, and refunds are rows of their own (#80)", () => {
    for (const event of PAYMENT_BATCH_EVENTS) {
      expect(nextPaymentBatchStatus("captured", event)).toEqual({
        ok: false,
        reason: "forbidden_transition",
        from: "captured",
        event,
      });
    }
  });

  it("records an offline payment only on a batch nobody has paid yet", () => {
    const recordable = PAYMENT_BATCH_STATUSES.filter(
      (from) => nextPaymentBatchStatus(from, "offline_recorded").ok
    );
    expect(recordable).toEqual(["created", "order_created"]);
  });

  it("leaves review only by resolving its case", () => {
    const leaving = PAYMENT_BATCH_EVENTS.filter((event) => {
      const next = nextPaymentBatchStatus("needs_review", event);
      return next.ok && next.to !== "needs_review";
    });
    expect(leaving).toEqual([
      "review_confirmed",
      "review_cleared",
      "review_dismissed",
    ]);
  });
});

describe("holdsRegistrations()", () => {
  it("holds the registrations of a batch that is open or paid", () => {
    expect(holdsRegistrations("created")).toBe(true);
    expect(holdsRegistrations("order_created")).toBe(true);
    expect(holdsRegistrations("captured")).toBe(true);
  });

  it("keeps them while a capture on the batch is in review, so nobody pays for them twice", () => {
    expect(holdsRegistrations("needs_review")).toBe(true);
  });

  it("lets go of them once the batch failed or was cancelled", () => {
    expect(holdsRegistrations("failed")).toBe(false);
    expect(holdsRegistrations("cancelled")).toBe(false);
  });
});
