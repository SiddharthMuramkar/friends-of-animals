import {
  syncAuctionBatch,
  acceptReviewedAuction,
  settleAuctionRefund,
} from "../auctions/payments";
// What a payment batch pays for decides what its money does (#106). The
// payments module keeps the one funnel every signal goes through (the
// signature, the replay guard, the gateway's own record of the order and
// the batch lock), and hands a batch of another purpose than registration
// fees to that purpose's module, in the funnel's transaction:
//
//   sync            what the order's payments mean: capture, refuse,
//                   review (./sync-batch.ts)
//   acceptReviewed  staff accepted a payment in review
//                   (./resolve-review-case.ts)
//   refundSettled   a refund of the batch reached `refunded`
//                   (./refunds/sync-refund.ts)
//
// Registration fees keep their own path in those files. A new purpose
// (auctions, #133) is added to PAYMENT_PURPOSES and handled here; the
// switch fails type-checking until it is. Loads under plain Node.

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import type { PaymentBatchRow } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { GatewayPayment } from "../../ports/payment-gateway";
import type { Settings } from "../../ports/settings";
import {
  acceptReviewedDonation,
  settleDonationRefund,
  syncDonationBatch,
} from "../donations/payments";
import type { PaymentPurpose } from "./domain/batch-status";
import type { SyncOutcome } from "./domain/outcomes";

export type PurposeContext = {
  db: AppDb;
  clock: Clock;
  actor: Actor;
  cipher: FieldCipher;
  settings: Settings;
};

export type PaymentPurposeHandler = {
  sync(
    tx: AppDb,
    ctx: PurposeContext,
    batch: PaymentBatchRow,
    payments: readonly GatewayPayment[],
    actorRole: Role | null,
    observedAt: Date
  ): Promise<SyncOutcome>;
  acceptReviewed(
    tx: AppDb,
    ctx: PurposeContext,
    batch: PaymentBatchRow,
    gatewayPaymentId: string,
    actorRole: Role | null
  ): Promise<void>;
  refundSettled(
    tx: AppDb,
    ctx: Pick<PurposeContext, "clock" | "actor">,
    refundId: string,
    actorRole: Role | null
  ): Promise<void>;
};

/** The handler for a batch that pays for something other than fees. */
export function purposeHandler(
  purpose: Exclude<PaymentPurpose, "registration_fee">
): PaymentPurposeHandler {
  switch (purpose) {
    case "auction_sale":
      return {
        sync: syncAuctionBatch,
        acceptReviewed: acceptReviewedAuction,
        refundSettled: settleAuctionRefund,
      };
    case "donation":
      return {
        sync: syncDonationBatch,
        acceptReviewed: acceptReviewedDonation,
        refundSettled: settleDonationRefund,
      };
  }
}
