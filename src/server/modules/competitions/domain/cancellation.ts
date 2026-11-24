// What cancelling a competition does to its registrations and payments
// (#80). Every paid fee goes back without finance's approval: one
// cancellation refund per paid batch, for each student not already
// refunded and not held by an approved or processing refund. A discretionary
// refund awaiting finance or definitively failed is superseded. A student
// an approved or processing refund holds, even with no paise allocated to
// them, stays with it: that refund settles them. A student a reviewed
// receipt leaves no share of is covered by their batch's refund with no
// paise, as a whole-batch refund covers them (#80), when the batch has a
// share to pay back; otherwise they are cancelled.
// Unpaid and free registrations are cancelled, open batches with them, and
// everyone still taking part is told, with how their fee comes back, as
// are the coordinators of every institution registered.

import { allocateRefundItems } from "../../payments/domain/refund-plan";

/** Where a registration stands just before the cancellation. */
export type RegistrationStanding =
  /** Enrolled, waiting for its own payment, or held for a guardian. */
  "unpaid" | "confirmed" | "withdrawn" | "refunded" | "cancelled";

/** Where a paid batch's student stands with refunds. */
export type PaidItemRefund =
  | { kind: "none" }
  /** In a discretionary refund that cancellation can replace. */
  | { kind: "supersede"; refundId: string }
  /** In an existing refund whose items must stay held. */
  | { kind: "held"; amountMinor?: bigint }
  | { kind: "refunded"; amountMinor?: bigint };

/** One student a captured batch paid for (a batch item). */
export type PaidItem = {
  batchId: string;
  registrationId: string;
  amountMinor: bigint;
  refund: PaidItemRefund;
};

type DashboardRefund = {
  caseId: string;
  amountMinor: bigint;
  currency: string;
};

export type CancellationInput = {
  registrations: readonly { id: string; standing: RegistrationStanding }[];
  /** The competition's institution registrations. */
  institutionRegistrationIds: readonly string[];
  /** The competition's captured batches; offline ones are paid back by hand. */
  paidBatches: readonly {
    id: string;
    method: "gateway" | "offline";
    /** The original capture less settled and outstanding refunds. */
    refundBalanceMinor: bigint;
    /** Whether to allocate from a reviewed receipt instead of the nominal fees. */
    reviewed?: boolean;
    /** A legacy receipt that needs refunding in the gateway dashboard. */
    dashboardRefund?: DashboardRefund;
  }[];
  /** Every student those batches hold. */
  paidItems: readonly PaidItem[];
  /** Batches still waiting for payment. */
  openBatchIds: readonly string[];
};

export type PlannedRefund = {
  batchId: string;
  method: "gateway" | "manual";
  /** The students it refunds or covers with no share, in the batch's input
   * order. */
  registrationIds: string[];
  amountMinor: bigint;
};

/** How a told registration's fee comes back: through the gateway, by hand,
 * or not at all (it was free or never paid). */
export const FEE_RETURNS = ["gateway", "manual", "dashboard", "none"] as const;

export type FeeReturn = (typeof FEE_RETURNS)[number];

export type CancellationPlan = {
  /** Discretionary refunds to reject so the cancellation can take over. */
  supersede: string[];
  /** One cancellation refund per paid batch with something left to pay. */
  refunds: PlannedRefund[];
  dashboardRefunds: DashboardRefund[];
  /** Unpaid and free registrations, cancelled now. */
  cancelRegistrations: string[];
  cancelBatches: string[];
  notify: {
    /** Everyone still taking part, each once. */
    registrations: { registrationId: string; refund: FeeReturn }[];
    /** Each institution registration, for its coordinators. */
    institutionRegistrations: string[];
  };
};

export function planCancellation(input: CancellationInput): CancellationPlan {
  const supersede = new Set<string>();
  const itemsByBatch = new Map<string, PaidItem[]>();
  /** Each paid registration still to be paid back, and how. */
  const paidBack = new Map<string, FeeReturn>();

  for (const paid of input.paidItems) {
    const items = itemsByBatch.get(paid.batchId) ?? [];
    items.push(paid);
    itemsByBatch.set(paid.batchId, items);
  }

  const refunds: PlannedRefund[] = [];
  const dashboardRefunds: DashboardRefund[] = [];
  for (const batch of input.paidBatches) {
    const items = itemsByBatch.get(batch.id) ?? [];
    if (batch.dashboardRefund) {
      dashboardRefunds.push(batch.dashboardRefund);
      for (const item of items) {
        if (item.refund.kind === "supersede")
          supersede.add(item.refund.refundId);
        if (item.refund.kind !== "refunded")
          paidBack.set(item.registrationId, "dashboard");
      }
      continue;
    }
    const method = batch.method === "offline" ? "manual" : "gateway";
    const shares = batch.reviewed
      ? allocateRefundItems(
          batch.refundBalanceMinor,
          items.map(({ amountMinor, refund }) => ({
            amountMinor,
            heldMinor:
              refund.kind === "held" || refund.kind === "refunded"
                ? (refund.amountMinor ?? amountMinor)
                : null,
          }))
        )
      : null;
    const covered: { registrationId: string; share: bigint }[] = [];
    for (const [index, item] of items.entries()) {
      const { registrationId, refund } = item;
      if (refund.kind === "supersede") supersede.add(refund.refundId);
      if (refund.kind === "refunded") continue;
      if (refund.kind === "held") {
        paidBack.set(registrationId, method);
        continue;
      }
      covered.push({
        registrationId,
        share: shares?.[index] ?? item.amountMinor,
      });
    }
    // With no share to pay back at all, there is nothing to cover them with.
    const registrationIds = covered.some(({ share }) => share > 0n)
      ? covered.map(({ registrationId }) => registrationId)
      : [];
    for (const registrationId of registrationIds) {
      paidBack.set(registrationId, method);
    }
    if (registrationIds.length > 0 || batch.refundBalanceMinor > 0n) {
      refunds.push({
        batchId: batch.id,
        method,
        registrationIds,
        amountMinor: batch.refundBalanceMinor,
      });
    }
  }

  const taking = input.registrations.filter(
    (registration) =>
      registration.standing === "unpaid" ||
      registration.standing === "confirmed"
  );

  return {
    supersede: [...supersede],
    refunds,
    dashboardRefunds,
    cancelRegistrations: taking
      .filter(
        (registration) =>
          registration.standing === "unpaid" || !paidBack.has(registration.id)
      )
      .map((registration) => registration.id),
    cancelBatches: [...input.openBatchIds],
    notify: {
      registrations: taking.map((registration) => ({
        registrationId: registration.id,
        refund:
          registration.standing === "confirmed"
            ? (paidBack.get(registration.id) ?? "none")
            : "none",
      })),
      institutionRegistrations: [...input.institutionRegistrationIds],
    },
  };
}
