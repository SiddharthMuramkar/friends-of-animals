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
  currency: "INR";
  items: readonly {
    id: string;
    amountMinor: bigint;
    refund: ItemRefundState;
  }[];
};

/** No `registrationIds` means every item that is left. */
export type RefundRequest = { registrationIds?: readonly string[] };

export type RefundPlan =
  | {
      ok: true;
      /** In the order asked for; batch order for a whole-batch refund. */
      registrationIds: string[];
      amountMinor: bigint;
      currency: "INR";
    }
  | {
      ok: false;
      reason: "batch_not_captured" | "empty" | "nothing_to_refund" | "exceeds_paid";
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
    if (request.registrationIds.length === 0) return { ok: false, reason: "empty" };
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
    registrationIds: chosen.map((item) => item.id),
    amountMinor,
    currency: batch.currency,
  };
}
