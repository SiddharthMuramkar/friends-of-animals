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
  paid: boolean;
  /** What the batch captured, in paise. */
  amountMinor: bigint;
  currency: "INR";
  items: readonly {
    id: string;
    amountMinor: bigint;
    refund: ItemRefundState;
  }[];
};

/** No `itemIds` means every item that is left. */
export type RefundRequest = { itemIds?: readonly string[] };

export type RefundPlan =
  | {
      ok: true;
      /** In the order asked for; batch order for a whole-batch refund. */
      itemIds: string[];
      amountMinor: bigint;
      currency: "INR";
    }
  | {
      ok: false;
      reason: "batch_not_paid" | "empty" | "nothing_to_refund" | "exceeds_paid";
    }
  | {
      ok: false;
      reason:
        | "duplicate_item"
        | "unknown_item"
        | "item_in_live_refund"
        | "item_already_refunded";
      itemId: string;
    };

export function planRefund(
  batch: RefundableBatch,
  request: RefundRequest
): RefundPlan {
  if (!batch.paid) return { ok: false, reason: "batch_not_paid" };

  const byId = new Map(batch.items.map((item) => [item.id, item]));
  let chosen: RefundableBatch["items"][number][];
  if (request.itemIds === undefined) {
    chosen = batch.items.filter((item) => item.refund === "none");
  } else {
    if (request.itemIds.length === 0) return { ok: false, reason: "empty" };
    chosen = [];
    const seen = new Set<string>();
    for (const itemId of request.itemIds) {
      if (seen.has(itemId)) {
        return { ok: false, reason: "duplicate_item", itemId };
      }
      seen.add(itemId);
      const item = byId.get(itemId);
      if (!item) return { ok: false, reason: "unknown_item", itemId };
      if (item.refund === "live") {
        return { ok: false, reason: "item_in_live_refund", itemId };
      }
      if (item.refund === "refunded") {
        return { ok: false, reason: "item_already_refunded", itemId };
      }
      chosen.push(item);
    }
  }

  const amountMinor = chosen.reduce((sum, item) => sum + item.amountMinor, 0n);
  if (amountMinor <= 0n) return { ok: false, reason: "nothing_to_refund" };

  const alreadyOut = batch.items
    .filter((item) => item.refund !== "none")
    .reduce((sum, item) => sum + item.amountMinor, 0n);
  if (alreadyOut + amountMinor > batch.amountMinor) {
    return { ok: false, reason: "exceeds_paid" };
  }

  return {
    ok: true,
    itemIds: chosen.map((item) => item.id),
    amountMinor,
    currency: batch.currency,
  };
}
