// Refunds (#80): a captured batch's money going back. Discretionary refunds
// are asked for by a competition manager or staff admin and decided by
// finance behind a fresh second factor; cancellation (80b) and duplicate
// (#79's review) refunds are approved by the system. Every approved
// gateway refund goes out through one funnel (./sync-refund.ts), from the
// outbox, so retries, lost answers and refund webhooks all end the same.
// Its use cases join `as(actor)` through the payments module's facade.

import type { UseCaseContext } from "../../../use-cases";
import {
  approveRefund,
  rejectRefund,
  type ApproveRefundInput,
  type RejectRefundInput,
} from "./decide-refund";
import {
  getRefund,
  getRefundableBatch,
  listRefunds,
  type GetRefundableBatchInput,
  type GetRefundInput,
  type ListRefundsInput,
} from "./list-refunds";
import {
  requestRefund,
  type RequestRefundInput,
} from "./request-refund";
import {
  recordManualRefund,
  retryRefund,
  type RecordManualRefundInput,
  type RetryRefundInput,
} from "./retry-refund";

export type {
  ApproveRefundInput,
  ApproveRefundResult,
  RejectRefundInput,
  RejectRefundResult,
} from "./decide-refund";
export type {
  GetRefundableBatchInput,
  GetRefundableBatchResult,
  GetRefundInput,
  GetRefundResult,
  ListRefundsInput,
  ListRefundsResult,
  RefundableBatch,
  RefundListItem,
  RefundListState,
  RefundView,
} from "./list-refunds";
export type {
  RecordManualRefundInput,
  RecordManualRefundResult,
  RetryRefundInput,
  RetryRefundResult,
} from "./retry-refund";
export type {
  RequestRefundInput,
  RequestRefundResult,
} from "./request-refund";

export const refundsUseCases = (ctx: UseCaseContext) => ({
  requestRefund: (input: RequestRefundInput) => requestRefund(ctx, input),
  approveRefund: (input: ApproveRefundInput) => approveRefund(ctx, input),
  rejectRefund: (input: RejectRefundInput) => rejectRefund(ctx, input),
  retryRefund: (input: RetryRefundInput) => retryRefund(ctx, input),
  recordManualRefund: (input: RecordManualRefundInput) =>
    recordManualRefund(ctx, input),
  listRefunds: (input: ListRefundsInput) => listRefunds(ctx, input),
  getRefund: (input: GetRefundInput) => getRefund(ctx, input),
  getRefundableBatch: (input: GetRefundableBatchInput) =>
    getRefundableBatch(ctx, input),
});
