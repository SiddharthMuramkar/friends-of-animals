// What cancelling a competition does to its registrations and payments
// (#80). Every paid fee goes back without finance's approval: one
// cancellation refund per paid batch, for each item not already refunded
// and not held by an approved refund. A refund still waiting for finance is
// superseded and its items join the cancellation refund. Unpaid and free
// registrations are cancelled, open batches with them, and everyone still
// taking part is told. Pure; no imports.

/** Where a registration stands just before the cancellation. */
export type RegistrationStanding =
  /** Enrolled, waiting for payment or for a guardian. */
  "unpaid" | "confirmed" | "withdrawn" | "refunded" | "cancelled";

/** Where a paid batch item stands with refunds. */
export type PaidItemRefund =
  | { kind: "none" }
  /** In a discretionary refund finance hasn't decided yet. */
  | { kind: "requested"; refundId: string }
  /** In an approved, processing or failed refund: it will be paid. */
  | { kind: "held" }
  | { kind: "refunded" };

export type PaidItem = {
  itemId: string;
  batchId: string;
  registrationId: string;
  amountMinor: bigint;
  refund: PaidItemRefund;
};

export type CancellationInput = {
  registrations: readonly { id: string; standing: RegistrationStanding }[];
  /** The competition's captured batches; offline ones are paid back by hand. */
  paidBatches: readonly { id: string; method: "gateway" | "offline" }[];
  /** Every item of those batches. */
  paidItems: readonly PaidItem[];
  /** Batches still waiting for payment. */
  openBatchIds: readonly string[];
};

export type PlannedRefund = {
  batchId: string;
  method: "gateway" | "manual";
  itemIds: string[];
  amountMinor: bigint;
};

export type CancellationPlan = {
  /** Requested refunds to reject, superseded by the cancellation. */
  supersede: string[];
  /** One cancellation refund per paid batch with something left to pay. */
  refunds: PlannedRefund[];
  /** Unpaid and free registrations, cancelled now. */
  cancelRegistrations: string[];
  cancelBatches: string[];
  /** Everyone still taking part, told about the cancellation. */
  notify: string[];
};

export function planCancellation(input: CancellationInput): CancellationPlan {
  const supersede = new Set<string>();
  const refundable = new Map<string, PaidItem[]>();
  const paidRegistrations = new Set<string>();

  for (const paid of input.paidItems) {
    if (paid.amountMinor <= 0n) continue;
    paidRegistrations.add(paid.registrationId);
    if (paid.refund.kind === "requested") supersede.add(paid.refund.refundId);
    if (paid.refund.kind === "none" || paid.refund.kind === "requested") {
      const items = refundable.get(paid.batchId) ?? [];
      items.push(paid);
      refundable.set(paid.batchId, items);
    }
  }

  const refunds: PlannedRefund[] = [];
  for (const batch of input.paidBatches) {
    const items = refundable.get(batch.id);
    if (!items) continue;
    refunds.push({
      batchId: batch.id,
      method: batch.method === "offline" ? "manual" : "gateway",
      itemIds: items.map((paid) => paid.itemId),
      amountMinor: items.reduce((sum, paid) => sum + paid.amountMinor, 0n),
    });
  }

  const taking = input.registrations.filter(
    (registration) =>
      registration.standing === "unpaid" ||
      registration.standing === "confirmed"
  );

  return {
    supersede: [...supersede],
    refunds,
    cancelRegistrations: taking
      .filter(
        (registration) =>
          registration.standing === "unpaid" ||
          !paidRegistrations.has(registration.id)
      )
      .map((registration) => registration.id),
    cancelBatches: [...input.openBatchIds],
    notify: taking.map((registration) => registration.id),
  };
}
