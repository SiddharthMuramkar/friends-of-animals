// Refunds (#80): a captured batch's money going back. Discretionary refunds
// are asked for by a competition manager or staff admin and decided by
// finance behind a fresh second factor; cancellation (80b) and duplicate
// (#79's review) refunds are approved by the system. Every approved
// gateway refund goes out through one funnel (./sync-refund.ts), from the
// outbox, so retries, lost answers and refund webhooks all end the same.
// Its use cases join `as(actor)` through the payments module's facade.

import type { UseCaseContext } from "../../../use-cases";
import {
  requestRefund,
  type RequestRefundInput,
} from "./request-refund";

export type {
  RequestRefundInput,
  RequestRefundResult,
} from "./request-refund";

export const refundsUseCases = (ctx: UseCaseContext) => ({
  requestRefund: (input: RequestRefundInput) => requestRefund(ctx, input),
});
