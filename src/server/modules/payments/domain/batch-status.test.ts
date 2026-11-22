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

  it("never leaves a captured batch: refunds belong to the refunds ticket", () => {
    for (const event of PAYMENT_BATCH_EVENTS) {
      expect(nextPaymentBatchStatus("captured", event).ok).toBe(false);
    }
  });
});

describe("holdsRegistrations()", () => {
  it("holds the registrations of a batch that is open or paid", () => {
    expect(holdsRegistrations("created")).toBe(true);
    expect(holdsRegistrations("order_created")).toBe(true);
    expect(holdsRegistrations("captured")).toBe(true);
  });

  it("lets go of them once the batch failed or was cancelled", () => {
    expect(holdsRegistrations("failed")).toBe(false);
    expect(holdsRegistrations("cancelled")).toBe(false);
  });
});
