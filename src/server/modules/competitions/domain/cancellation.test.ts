import { describe, expect, it } from "vitest";

import {
  planCancellation,
  type CancellationInput,
  type CancellationPlan,
  type PaidItem,
} from "./cancellation";

function item(
  overrides: Partial<PaidItem> & Pick<PaidItem, "registrationId">
): PaidItem {
  return {
    batchId: "batch-1",
    amountMinor: 25_000n,
    refund: { kind: "none" },
    ...overrides,
  };
}

const EMPTY: CancellationInput = {
  registrations: [],
  institutionRegistrationIds: [],
  paidBatches: [],
  paidItems: [],
  openBatchIds: [],
};

/** The registrations the plan tells, in its order. */
function told(plan: CancellationPlan): string[] {
  return plan.notify.registrations.map((each) => each.registrationId);
}

describe("planCancellation()", () => {
  it("does nothing for a competition nobody registered for", () => {
    expect(planCancellation(EMPTY)).toEqual({
      supersede: [],
      refunds: [],
      dashboardRefunds: [],
      cancelRegistrations: [],
      cancelBatches: [],
      notify: { registrations: [], institutionRegistrations: [] },
    });
  });

  it("refunds every paid batch in full, one refund per batch", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
        { id: "reg-3", standing: "confirmed" },
      ],
      paidBatches: [
        { id: "batch-1", method: "gateway", refundBalanceMinor: 50_000n },
        { id: "batch-2", method: "gateway", refundBalanceMinor: 40_000n },
      ],
      paidItems: [
        item({ registrationId: "reg-1" }),
        item({ registrationId: "reg-2" }),
        item({
          registrationId: "reg-3",
          batchId: "batch-2",
          amountMinor: 40_000n,
        }),
      ],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        registrationIds: ["reg-1", "reg-2"],
        amountMinor: 50_000n,
      },
      {
        batchId: "batch-2",
        method: "gateway",
        registrationIds: ["reg-3"],
        amountMinor: 40_000n,
      },
    ]);
    expect(plan.cancelRegistrations).toEqual([]);
    expect(told(plan)).toEqual(["reg-1", "reg-2", "reg-3"]);
  });

  it("skips items already refunded and items an approved refund holds", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "refunded" },
        { id: "reg-2", standing: "confirmed" },
        { id: "reg-3", standing: "confirmed" },
      ],
      paidBatches: [
        { id: "batch-1", method: "gateway", refundBalanceMinor: 25_000n },
      ],
      paidItems: [
        item({
          registrationId: "reg-1",
          refund: { kind: "refunded" },
        }),
        item({
          registrationId: "reg-2",
          refund: { kind: "held" },
        }),
        item({ registrationId: "reg-3" }),
      ],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        registrationIds: ["reg-3"],
        amountMinor: 25_000n,
      },
    ]);
    expect(plan.supersede).toEqual([]);
    expect(told(plan)).toEqual(["reg-2", "reg-3"]);
  });

  it("covers a student a reviewed receipt leaves no share of, with no paise, as a whole-batch refund does", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
      ],
      // A one-paise receipt for two 25,000-paise fees: the first rounds down.
      paidBatches: [
        {
          id: "batch-1",
          method: "gateway",
          refundBalanceMinor: 1n,
          reviewed: true,
        },
      ],
      paidItems: [
        item({ registrationId: "reg-1" }),
        item({ registrationId: "reg-2" }),
      ],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        registrationIds: ["reg-1", "reg-2"],
        amountMinor: 1n,
      },
    ]);
    expect(plan.cancelRegistrations).toEqual([]);
    expect(plan.notify.registrations).toEqual([
      { registrationId: "reg-1", refund: "gateway" },
      { registrationId: "reg-2", refund: "gateway" },
    ]);
  });

  it("leaves a student an approved refund covers with no paise to that refund", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
      ],
      paidBatches: [
        {
          id: "batch-1",
          method: "gateway",
          refundBalanceMinor: 1n,
          reviewed: true,
        },
      ],
      paidItems: [
        item({
          registrationId: "reg-1",
          refund: { kind: "held", amountMinor: 0n },
        }),
        item({ registrationId: "reg-2" }),
      ],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        registrationIds: ["reg-2"],
        amountMinor: 1n,
      },
    ]);
    expect(plan.cancelRegistrations).toEqual([]);
    expect(told(plan)).toEqual(["reg-1", "reg-2"]);
  });

  it("supersedes a refund still waiting for finance and refunds its items itself", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
      ],
      paidBatches: [
        { id: "batch-1", method: "gateway", refundBalanceMinor: 50_000n },
      ],
      paidItems: [
        item({
          registrationId: "reg-1",
          refund: { kind: "supersede", refundId: "refund-9" },
        }),
        item({
          registrationId: "reg-2",
          refund: { kind: "supersede", refundId: "refund-9" },
        }),
      ],
    });
    expect(plan.supersede).toEqual(["refund-9"]);
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "gateway",
        registrationIds: ["reg-1", "reg-2"],
        amountMinor: 50_000n,
      },
    ]);
  });

  it("asks finance to pay back an offline-paid batch by hand", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [{ id: "reg-1", standing: "confirmed" }],
      paidBatches: [
        { id: "batch-1", method: "offline", refundBalanceMinor: 25_000n },
      ],
      paidItems: [item({ registrationId: "reg-1" })],
    });
    expect(plan.refunds).toEqual([
      {
        batchId: "batch-1",
        method: "manual",
        registrationIds: ["reg-1"],
        amountMinor: 25_000n,
      },
    ]);
  });

  it("cancels unpaid registrations and their open batches", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "unpaid" },
        { id: "reg-2", standing: "unpaid" },
      ],
      openBatchIds: ["batch-open"],
    });
    expect(plan.cancelRegistrations).toEqual(["reg-1", "reg-2"]);
    expect(plan.cancelBatches).toEqual(["batch-open"]);
    expect(plan.refunds).toEqual([]);
    expect(told(plan)).toEqual(["reg-1", "reg-2"]);
  });

  it("cancels a free confirmed registration instead of refunding nothing", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-free", standing: "confirmed" },
        { id: "reg-zero", standing: "confirmed" },
      ],
      paidBatches: [
        { id: "batch-1", method: "gateway", refundBalanceMinor: 0n },
      ],
      paidItems: [item({ registrationId: "reg-zero", amountMinor: 0n })],
    });
    expect(plan.cancelRegistrations).toEqual(["reg-free", "reg-zero"]);
    expect(plan.refunds).toEqual([]);
    expect(told(plan)).toEqual(["reg-free", "reg-zero"]);
  });

  it("leaves withdrawn, refunded and cancelled registrations alone and tells them nothing", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-w", standing: "withdrawn" },
        { id: "reg-r", standing: "refunded" },
        { id: "reg-c", standing: "cancelled" },
      ],
    });
    expect(plan.cancelRegistrations).toEqual([]);
    expect(told(plan)).toEqual([]);
  });

  it("never refunds a batch more than once, whatever order its items come in", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-1", standing: "confirmed" },
        { id: "reg-2", standing: "confirmed" },
        { id: "reg-3", standing: "confirmed" },
      ],
      paidBatches: [
        { id: "batch-1", method: "gateway", refundBalanceMinor: 50_000n },
        { id: "batch-2", method: "gateway", refundBalanceMinor: 25_000n },
      ],
      paidItems: [
        item({ registrationId: "reg-1" }),
        item({ registrationId: "reg-3", batchId: "batch-2" }),
        item({ registrationId: "reg-2" }),
      ],
    });
    expect(plan.refunds.map((refund) => refund.batchId)).toEqual([
      "batch-1",
      "batch-2",
    ]);
    expect(plan.refunds[0]?.registrationIds).toEqual(["reg-1", "reg-2"]);
  });

  it("refunds nothing for a paid batch whose items are all refunded or held", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [{ id: "reg-1", standing: "confirmed" }],
      paidBatches: [
        { id: "batch-1", method: "gateway", refundBalanceMinor: 0n },
      ],
      paidItems: [
        item({
          registrationId: "reg-1",
          refund: { kind: "held" },
        }),
      ],
    });
    expect(plan.refunds).toEqual([]);
    expect(plan.cancelRegistrations).toEqual([]);
    expect(told(plan)).toEqual(["reg-1"]);
  });

  it("tells each family how its fee comes back", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [
        { id: "reg-card", standing: "confirmed" },
        { id: "reg-cash", standing: "confirmed" },
        { id: "reg-held", standing: "confirmed" },
        { id: "reg-free", standing: "confirmed" },
        { id: "reg-unpaid", standing: "unpaid" },
      ],
      paidBatches: [
        { id: "batch-card", method: "gateway", refundBalanceMinor: 25_000n },
        { id: "batch-cash", method: "offline", refundBalanceMinor: 25_000n },
      ],
      paidItems: [
        item({
          registrationId: "reg-card",
          batchId: "batch-card",
        }),
        item({
          registrationId: "reg-cash",
          batchId: "batch-cash",
        }),
        item({
          registrationId: "reg-held",
          batchId: "batch-card",
          refund: { kind: "held" },
        }),
      ],
    });
    expect(plan.notify.registrations).toEqual([
      { registrationId: "reg-card", refund: "gateway" },
      { registrationId: "reg-cash", refund: "manual" },
      { registrationId: "reg-held", refund: "gateway" },
      { registrationId: "reg-free", refund: "none" },
      { registrationId: "reg-unpaid", refund: "none" },
    ]);
  });

  it("tells every institution registration's coordinators, students or not", () => {
    const plan = planCancellation({
      ...EMPTY,
      registrations: [{ id: "reg-1", standing: "unpaid" }],
      institutionRegistrationIds: ["inst-reg-1", "inst-reg-2"],
    });
    expect(plan.notify.institutionRegistrations).toEqual([
      "inst-reg-1",
      "inst-reg-2",
    ]);
  });
});
