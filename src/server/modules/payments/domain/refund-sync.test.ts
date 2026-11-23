import { describe, expect, it } from "vitest";

import {
  decideRefundSync,
  refundIdempotencyKey,
  refundNotes,
  type GatewayRefund,
  type RefundForSync,
} from "./refund-sync";

const REFUND: RefundForSync = {
  id: "refund-1",
  status: "approved",
  method: "gateway",
  attempt: 1,
  gatewayRefundId: null,
  paymentId: "pay_1",
  amountMinor: 50_000n,
  currency: "INR",
};

function atGateway(overrides: Partial<GatewayRefund> = {}): GatewayRefund {
  return {
    id: "rfnd_1",
    paymentId: "pay_1",
    amountMinor: 50_000n,
    currency: "INR",
    status: "pending",
    notes: { refundId: "refund-1", attempt: "1" },
    ...overrides,
  };
}

describe("refundNotes() and refundIdempotencyKey()", () => {
  it("name the refund and the attempt, so a retry is a new gateway refund", () => {
    expect(refundNotes(REFUND)).toEqual({ refundId: "refund-1", attempt: "1" });
    expect(refundIdempotencyKey(REFUND)).toBe("refund-1-1");
    expect(refundIdempotencyKey({ ...REFUND, attempt: 2 })).toBe("refund-1-2");
  });
});

describe("decideRefundSync()", () => {
  it("sends an approved refund the gateway has never seen", () => {
    expect(decideRefundSync(REFUND, [])).toEqual({ kind: "send" });
  });

  it("ignores the gateway's refunds of other payments and other refunds", () => {
    const others = [
      atGateway({ id: "rfnd_x", paymentId: "pay_2" }),
      atGateway({
        id: "rfnd_y",
        notes: { refundId: "refund-9", attempt: "1" },
      }),
    ];
    expect(decideRefundSync(REFUND, others)).toEqual({ kind: "send" });
  });

  it("adopts a refund the gateway made though its answer was lost, instead of sending again", () => {
    expect(decideRefundSync(REFUND, [atGateway()])).toEqual({
      kind: "apply",
      event: "sent",
      gatewayRefundId: "rfnd_1",
    });
  });

  it("marks a refund refunded when the gateway processed it", () => {
    expect(
      decideRefundSync(REFUND, [atGateway({ status: "processed" })])
    ).toEqual({ kind: "apply", event: "processed", gatewayRefundId: "rfnd_1" });
    expect(
      decideRefundSync(
        { ...REFUND, status: "processing", gatewayRefundId: "rfnd_1" },
        [atGateway({ status: "processed" })]
      )
    ).toEqual({ kind: "apply", event: "processed", gatewayRefundId: "rfnd_1" });
  });

  it("marks a refund failed when the gateway gave up", () => {
    expect(
      decideRefundSync(
        { ...REFUND, status: "processing", gatewayRefundId: "rfnd_1" },
        [atGateway({ status: "failed" })]
      )
    ).toEqual({
      kind: "apply",
      event: "gateway_failed",
      gatewayRefundId: "rfnd_1",
    });
  });

  it("changes nothing while the gateway is still working on it", () => {
    expect(
      decideRefundSync(
        { ...REFUND, status: "processing", gatewayRefundId: "rfnd_1" },
        [atGateway()]
      )
    ).toEqual({ kind: "unchanged" });
  });

  it("finds its refund by gateway id even without notes", () => {
    expect(
      decideRefundSync(
        { ...REFUND, status: "processing", gatewayRefundId: "rfnd_1" },
        [atGateway({ status: "processed", notes: {} })]
      )
    ).toEqual({ kind: "apply", event: "processed", gatewayRefundId: "rfnd_1" });
  });

  it("sends a retried refund again, ignoring the failed first attempt", () => {
    const retried: RefundForSync = { ...REFUND, attempt: 2 };
    expect(
      decideRefundSync(retried, [atGateway({ status: "failed" })])
    ).toEqual({ kind: "send" });
    expect(
      decideRefundSync(retried, [
        atGateway({ status: "failed" }),
        atGateway({
          id: "rfnd_2",
          status: "processed",
          notes: { refundId: "refund-1", attempt: "2" },
        }),
      ])
    ).toEqual({ kind: "apply", event: "processed", gatewayRefundId: "rfnd_2" });
  });

  it("stops on a gateway refund whose amount or currency is not ours", () => {
    expect(
      decideRefundSync(REFUND, [atGateway({ amountMinor: 40_000n })])
    ).toEqual({ kind: "amount_mismatch", gatewayRefundId: "rfnd_1" });
    expect(decideRefundSync(REFUND, [atGateway({ currency: "USD" })])).toEqual({
      kind: "amount_mismatch",
      gatewayRefundId: "rfnd_1",
    });
  });

  it("flags a processing refund the gateway no longer knows", () => {
    expect(
      decideRefundSync(
        { ...REFUND, status: "processing", gatewayRefundId: "rfnd_1" },
        []
      )
    ).toEqual({ kind: "missing_at_gateway" });
  });

  it("waits for finance on a refund paid out by hand", () => {
    expect(decideRefundSync({ ...REFUND, method: "manual" }, [])).toEqual({
      kind: "awaiting_manual",
    });
  });

  it.each(["requested", "rejected", "refunded", "failed"] as const)(
    "leaves a %s refund alone, whatever the gateway says",
    (status) => {
      expect(
        decideRefundSync({ ...REFUND, status, gatewayRefundId: "rfnd_1" }, [
          atGateway({ status: "processed" }),
        ])
      ).toEqual({ kind: "unchanged" });
    }
  );
});
