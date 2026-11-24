// Which batch items a refund covers, and for how much (#80). A refund lists
// items of one paid batch: all that are left (a whole-batch refund) or the
// ones asked for (a partial refund). An item is in at most one live refund,
// and a batch never gives back more than it captured. Pure; no imports.
//
// Duplicate refunds return a second payment, not batch items, so they don't
// pass through here.

/** Where an item stands with refunds: free, held by a live one, or done. */
export type ItemRefundState = "none" | "live" | "refunded";

export type RefundableBatch = {
  /** Captured, through the gateway or offline. */
  captured: boolean;
  /** What the batch captured, in paise. */
  amountMinor: bigint;
  /** What refunds of the original capture have settled or still hold. */
  committedMinor: bigint;
  currency: "INR";
  items: readonly {
    id: string;
    amountMinor: bigint;
    refund: ItemRefundState;
  }[];
};

/** No `registrationIds` means every item that is left. */
export type RefundRequest = { registrationIds?: readonly string[] };

/** Keep zero-share coverage separately from the positive refund item rows. */
export function splitRefundCoverage(
  items: RefundableBatch["items"],
  registrationIds: readonly string[]
) {
  const allocated = new Map(items.map((item) => [item.id, item.amountMinor]));
  const payableItems: { registrationId: string; amountMinor: bigint }[] = [];
  const zeroShareRegistrationIds: string[] = [];
  for (const registrationId of registrationIds) {
    const amountMinor = allocated.get(registrationId)!;
    if (amountMinor > 0n) payableItems.push({ registrationId, amountMinor });
    else zeroShareRegistrationIds.push(registrationId);
  }
  return { payableItems, zeroShareRegistrationIds };
}

/** Split the balance by item charge, keeping existing allocations. */
export function allocateRefundItems(
  balanceMinor: bigint,
  items: readonly { amountMinor: bigint; heldMinor: bigint | null }[]
): bigint[] {
  const remainingMinor = balanceMinor > 0n ? balanceMinor : 0n;
  let weight = 0n;
  for (const item of items) {
    if (item.heldMinor === null) weight += item.amountMinor;
  }

  // Consecutive boundaries rounded down give every remaining minor unit a
  // home, even when a capture did not divide evenly across its students.
  let usedWeight = 0n;
  let allocated = 0n;
  return items.map((item) => {
    if (item.heldMinor !== null) return item.heldMinor;
    if (weight === 0n) return 0n;
    usedWeight += item.amountMinor;
    const next = (remainingMinor * usedWeight) / weight;
    const share = next - allocated;
    allocated = next;
    return share;
  });
}

export type RefundPlan =
  | {
      ok: true;
      /** Every covered item, including zero shares, in selection order. */
      registrationIds: string[];
      amountMinor: bigint;
      currency: "INR";
    }
  | {
      ok: false;
      reason:
        | "batch_not_captured"
        | "empty"
        | "nothing_to_refund"
        | "exceeds_paid";
    }
  | {
      ok: false;
      reason:
        | "duplicate_item"
        | "unknown_item"
        | "item_in_live_refund"
        | "item_already_refunded";
      registrationId: string;
    };

export function planRefund(
  batch: RefundableBatch,
  request: RefundRequest
): RefundPlan {
  if (!batch.captured) return { ok: false, reason: "batch_not_captured" };

  const byId = new Map(batch.items.map((item) => [item.id, item]));
  let chosen: RefundableBatch["items"][number][];
  if (request.registrationIds === undefined) {
    chosen = batch.items.filter((item) => item.refund === "none");
  } else {
    if (request.registrationIds.length === 0)
      return { ok: false, reason: "empty" };
    chosen = [];
    const seen = new Set<string>();
    for (const registrationId of request.registrationIds) {
      if (seen.has(registrationId)) {
        return { ok: false, reason: "duplicate_item", registrationId };
      }
      seen.add(registrationId);
      const item = byId.get(registrationId);
      if (!item) return { ok: false, reason: "unknown_item", registrationId };
      if (item.refund === "live") {
        return { ok: false, reason: "item_in_live_refund", registrationId };
      }
      if (item.refund === "refunded") {
        return { ok: false, reason: "item_already_refunded", registrationId };
      }
      chosen.push(item);
    }
  }

  // A reviewed capture can round a registration's share down to zero.
  const payable = chosen.filter((item) => item.amountMinor > 0n);
  const amountMinor = payable.reduce((sum, item) => sum + item.amountMinor, 0n);
  if (amountMinor <= 0n) return { ok: false, reason: "nothing_to_refund" };

  if (batch.committedMinor + amountMinor > batch.amountMinor) {
    return { ok: false, reason: "exceeds_paid" };
  }

  return {
    ok: true,
    registrationIds: chosen.map((item) => item.id),
    amountMinor,
    currency: batch.currency,
  };
}
