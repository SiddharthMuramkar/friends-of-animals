import { describe, expect, it } from "vitest";

import {
  checkRefundDecision,
  holdsItems,
  initialRefundStatus,
  nextRefundStatus,
  REFUND_EVENTS,
  REFUND_KINDS,
  REFUND_STATUSES,
  type RefundEvent,
  type RefundStatus,
} from "./refund-status";

/** Every allowed move. Each other status and event pair is forbidden. */
const ALLOWED: ReadonlyArray<[RefundStatus, RefundEvent, RefundStatus]> = [
  ["requested", "approved", "approved"],
  ["requested", "rejected", "rejected"],
  ["approved", "sent", "processing"],
  ["approved", "processed", "refunded"],
  ["approved", "gateway_failed", "failed"],
  ["processing", "processed", "refunded"],
  ["processing", "gateway_failed", "failed"],
  ["failed", "retried", "approved"],
  ["failed", "rejected", "rejected"],
];

const allowedTo = (from: RefundStatus, event: RefundEvent) =>
  ALLOWED.find(([f, e]) => f === from && e === event)?.[2];

const EVERY_PAIR = REFUND_STATUSES.flatMap((from) =>
  REFUND_EVENTS.map((event) => [from, event] as const)
);

describe("nextRefundStatus()", () => {
  it.each(ALLOWED)("moves %s on %s to %s", (from, event, to) => {
    expect(nextRefundStatus(from, event)).toEqual({ ok: true, to });
  });

  it.each(EVERY_PAIR.filter(([from, event]) => !allowedTo(from, event)))(
    "refuses %s on %s",
    (from, event) => {
      expect(nextRefundStatus(from, event)).toEqual({
        ok: false,
        reason: "forbidden_transition",
        from,
        event,
      });
    }
  );

  it("covers every status and event pair exactly once", () => {
    expect(EVERY_PAIR).toHaveLength(36);
    expect(EVERY_PAIR.filter(([f, e]) => allowedTo(f, e))).toHaveLength(9);
  });

  it("never leaves a rejected or refunded refund", () => {
    for (const event of REFUND_EVENTS) {
      expect(nextRefundStatus("rejected", event).ok).toBe(false);
      expect(nextRefundStatus("refunded", event).ok).toBe(false);
    }
  });

  it("sends nothing before approval: a requested refund can't be sent or processed", () => {
    expect(nextRefundStatus("requested", "sent").ok).toBe(false);
    expect(nextRefundStatus("requested", "processed").ok).toBe(false);
  });
});

describe("initialRefundStatus()", () => {
  it("makes a discretionary refund wait for finance", () => {
    expect(initialRefundStatus("discretionary")).toBe("requested");
  });

  it("approves cancellation and duplicate refunds at once", () => {
    expect(initialRefundStatus("cancellation")).toBe("approved");
    expect(initialRefundStatus("duplicate")).toBe("approved");
  });

  it("approves a donation's foreign payment refund at once (#106)", () => {
    expect(initialRefundStatus("foreign_payment")).toBe("approved");
  });

  it("knows exactly five kinds", () => {
    expect(REFUND_KINDS).toEqual([
      "discretionary",
      "cancellation",
      "duplicate",
      "foreign_payment",
      "recurring_after_cancel",
    ]);
  });
});

describe("holdsItems()", () => {
  it("holds the items of every refund except a rejected one", () => {
    expect(REFUND_STATUSES.filter((status) => !holdsItems(status))).toEqual([
      "rejected",
    ]);
  });
});

describe("checkRefundDecision()", () => {
  const requested = {
    status: "requested" as const,
    requestedBy: "user-requester",
  };

  it("lets another person decide a requested refund", () => {
    expect(checkRefundDecision(requested, "user-finance")).toEqual({
      ok: true,
    });
  });

  it("never lets the requester decide their own refund", () => {
    expect(checkRefundDecision(requested, "user-requester")).toEqual({
      ok: false,
      reason: "same_person",
    });
  });

  it.each(REFUND_STATUSES.filter((status) => status !== "requested"))(
    "refuses to decide a refund that is %s",
    (status) => {
      expect(
        checkRefundDecision({ status, requestedBy: null }, "user-finance")
      ).toEqual({ ok: false, reason: "not_requested" });
    }
  );
});
