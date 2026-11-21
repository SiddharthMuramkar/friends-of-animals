import { describe, expect, it } from "vitest";

import {
  approvalExpiresAt,
  assertFinanceApprovalTransition,
  canTransitionFinanceApproval,
  decideFinanceApproval,
  DEFAULT_APPROVAL_EXPIRY_DAYS,
  DEFAULT_MANUAL_ENTRY_APPROVAL_THRESHOLD_MINOR,
  FINANCE_APPROVAL_STATUSES,
  FINANCE_OPERATIONS,
  FinanceApprovalTransitionError,
  manualEntryTotalMinor,
  needsSecondApprover,
  type FinanceApprovalStatus,
  type PendingRequest,
} from "./approval";

// The expected machine, written out by hand. A ticket that adds a
// transition adds its row here and in the module's table.
const ALLOWED: readonly (readonly [
  FinanceApprovalStatus | null,
  FinanceApprovalStatus,
])[] = [
  // A finance user asks for a covered operation.
  [null, "pending"],
  // A different finance user approves, with step-up; the operation runs.
  ["pending", "approved"],
  // A different finance user turns it down, with a reason.
  ["pending", "rejected"],
  // The requester withdraws it.
  ["pending", "cancelled"],
  // Nobody decided within the expiry window.
  ["pending", "expired"],
];

const FROM: readonly (FinanceApprovalStatus | null)[] = [
  null,
  ...FINANCE_APPROVAL_STATUSES,
];

const PAIRS = FROM.flatMap((from) =>
  FINANCE_APPROVAL_STATUSES.map((to) => ({
    from,
    to,
    allowed: ALLOWED.some(([f, t]) => f === from && t === to),
  }))
);

describe("finance approval status transitions", () => {
  it("has the five statuses", () => {
    expect(FINANCE_APPROVAL_STATUSES).toEqual([
      "pending",
      "approved",
      "rejected",
      "cancelled",
      "expired",
    ]);
  });

  it.each(PAIRS)("$from -> $to allowed: $allowed", ({ from, to, allowed }) => {
    expect(canTransitionFinanceApproval(from, to)).toBe(allowed);
    if (allowed) {
      expect(() => assertFinanceApprovalTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertFinanceApprovalTransition(from, to)).toThrow(
        FinanceApprovalTransitionError
      );
    }
  });
});

describe("the operations covered by the two-approver rule", () => {
  it("are period lock, period unlock and large manual entries", () => {
    expect(FINANCE_OPERATIONS).toEqual([
      "period_lock",
      "period_unlock",
      "manual_entry",
    ]);
  });

  it("always need a second approver for a lock or an unlock", () => {
    expect(needsSecondApprover({ operation: "period_lock" })).toBe(true);
    expect(needsSecondApprover({ operation: "period_unlock" })).toBe(true);
  });

  it("need one for a manual entry only above the threshold", () => {
    const threshold = 5_000_000n; // Rs 50,000
    expect(
      needsSecondApprover({
        operation: "manual_entry",
        totalMinor: 5_000_001n,
        thresholdMinor: threshold,
      })
    ).toBe(true);
    expect(
      needsSecondApprover({
        operation: "manual_entry",
        totalMinor: 5_000_000n,
        thresholdMinor: threshold,
      })
    ).toBe(false);
    expect(
      needsSecondApprover({
        operation: "manual_entry",
        totalMinor: 100n,
        thresholdMinor: threshold,
      })
    ).toBe(false);
  });

  it("defaults to Rs 50,000 and 7 days", () => {
    expect(DEFAULT_MANUAL_ENTRY_APPROVAL_THRESHOLD_MINOR).toBe(5_000_000n);
    expect(DEFAULT_APPROVAL_EXPIRY_DAYS).toBe(7);
  });
});

describe("manualEntryTotalMinor", () => {
  it("is the sum of the debits", () => {
    expect(
      manualEntryTotalMinor([
        { debitMinor: 70_000n, creditMinor: 0n },
        { debitMinor: 30_000n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 100_000n },
      ])
    ).toBe(100_000n);
  });

  it("is zero for no lines", () => {
    expect(manualEntryTotalMinor([])).toBe(0n);
  });
});

const REQUESTED_AT = new Date("2026-11-21T04:30:00.000Z");
const ASHA = "0193a000-0000-7000-8000-00000000000a";
const BILAL = "0193a000-0000-7000-8000-00000000000b";

const pending: PendingRequest = {
  status: "pending",
  requestedByUserId: ASHA,
  requestedAt: REQUESTED_AT,
};

const decide = (
  decision: Parameters<typeof decideFinanceApproval>[0]["decision"],
  overrides: { request?: PendingRequest; now?: Date } = {}
) =>
  decideFinanceApproval({
    request: overrides.request ?? pending,
    decision,
    now: overrides.now ?? new Date("2026-11-22T04:30:00.000Z"),
    expiryDays: 7,
  });

describe("approvalExpiresAt", () => {
  it("is the request time plus the expiry days", () => {
    expect(approvalExpiresAt(REQUESTED_AT, 7).toISOString()).toBe(
      "2026-11-28T04:30:00.000Z"
    );
  });

  it("refuses a window that isn't a positive whole number of days", () => {
    expect(() => approvalExpiresAt(REQUESTED_AT, 0)).toThrow(RangeError);
    expect(() => approvalExpiresAt(REQUESTED_AT, 1.5)).toThrow(RangeError);
  });
});

describe("decideFinanceApproval", () => {
  it("lets a different finance user approve", () => {
    expect(decide({ kind: "approve", byUserId: BILAL })).toEqual({
      ok: true,
      to: "approved",
    });
  });

  it("refuses the requester approving their own request", () => {
    expect(decide({ kind: "approve", byUserId: ASHA })).toEqual({
      ok: false,
      reason: "self_approval",
    });
  });

  it("lets a different finance user reject with a reason", () => {
    expect(
      decide({ kind: "reject", byUserId: BILAL, reason: "Bank not reconciled" })
    ).toEqual({ ok: true, to: "rejected" });
  });

  it("refuses a rejection without a reason", () => {
    expect(decide({ kind: "reject", byUserId: BILAL, reason: "  " })).toEqual({
      ok: false,
      reason: "reason_required",
    });
  });

  it("refuses the requester rejecting their own request", () => {
    expect(
      decide({ kind: "reject", byUserId: ASHA, reason: "Changed my mind" })
    ).toEqual({ ok: false, reason: "self_approval" });
  });

  it("lets only the requester cancel", () => {
    expect(decide({ kind: "cancel", byUserId: ASHA })).toEqual({
      ok: true,
      to: "cancelled",
    });
    expect(decide({ kind: "cancel", byUserId: BILAL })).toEqual({
      ok: false,
      reason: "not_requester",
    });
  });

  it.each(["approved", "rejected", "cancelled", "expired"] as const)(
    "refuses every decision on a %s request",
    (status) => {
      const request = { ...pending, status };
      for (const decision of [
        { kind: "approve", byUserId: BILAL },
        { kind: "reject", byUserId: BILAL, reason: "No" },
        { kind: "cancel", byUserId: ASHA },
        { kind: "expire" },
      ] as const) {
        expect(
          decide(decision, { request, now: new Date("2027-01-01T00:00:00Z") })
        ).toEqual({ ok: false, reason: "not_pending" });
      }
    }
  );

  describe("at and after expiry", () => {
    const expiresAt = new Date("2026-11-28T04:30:00.000Z");
    const justBefore = new Date(expiresAt.getTime() - 1);

    it("still accepts a decision a millisecond before", () => {
      expect(
        decide({ kind: "approve", byUserId: BILAL }, { now: justBefore })
      ).toEqual({ ok: true, to: "approved" });
    });

    it("refuses approve, reject and cancel once expired, even before the job runs", () => {
      expect(
        decide({ kind: "approve", byUserId: BILAL }, { now: expiresAt })
      ).toEqual({ ok: false, reason: "request_expired" });
      expect(
        decide(
          { kind: "reject", byUserId: BILAL, reason: "Late" },
          { now: expiresAt }
        )
      ).toEqual({ ok: false, reason: "request_expired" });
      expect(
        decide({ kind: "cancel", byUserId: ASHA }, { now: expiresAt })
      ).toEqual({ ok: false, reason: "request_expired" });
    });

    it("lets the expiry job expire it from then on, not before", () => {
      expect(decide({ kind: "expire" }, { now: expiresAt })).toEqual({
        ok: true,
        to: "expired",
      });
      expect(decide({ kind: "expire" }, { now: justBefore })).toEqual({
        ok: false,
        reason: "not_due",
      });
    });
  });
});
