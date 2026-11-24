// The payments module (#77): an institution pays its students' fees in
// one gateway order, and every signal from the gateway (the Checkout
// return, a webhook) is checked against the gateway's own record of the
// order before anything is confirmed. Its use cases join `as(actor)`
// through `paymentsUseCases`. The adapters live in src/server/ports, the
// webhook route in src/app/api/webhooks and the pay pages under
// src/app/institution/registrations/[ref].

import type { UseCaseContext } from "../../use-cases";
import { refundsUseCases } from "./refunds";
import { confirmCheckout, type ConfirmCheckoutInput } from "./confirm-checkout";
import { getFeesToPay, type GetFeesToPayInput } from "./get-fees-to-pay";
import {
  getPaymentBatch,
  type GetPaymentBatchInput,
} from "./get-payment-batch";
import {
  payInstitutionFees,
  type PayInstitutionFeesInput,
} from "./pay-institution-fees";
import {
  payTestCheckout,
  type PayTestCheckoutInput,
} from "./pay-test-checkout";
import {
  receiveGatewayWebhook,
  type ReceiveGatewayWebhookInput,
} from "./receive-gateway-webhook";
import {
  getOfflinePaymentProof,
  type GetOfflinePaymentProofInput,
} from "./offline-proof";
import {
  getPaymentBatchForStaff,
  type GetPaymentBatchForStaffInput,
} from "./staff-batch";
import {
  recordDashboardRefund,
  resolvePaymentReviewCase,
  type RecordDashboardRefundInput,
  type ResolvePaymentReviewCaseInput,
} from "./resolve-review-case";
import {
  getPaymentReviewCase,
  listPaymentReviewCases,
  type GetPaymentReviewCaseInput,
  type ListPaymentReviewCasesInput,
} from "./review-cases";
import {
  recordOfflinePayment,
  requestOfflinePaymentProofUpload,
  type RecordOfflinePaymentInput,
  type RequestOfflinePaymentProofUploadInput,
} from "./record-offline-payment";

export type {
  ReceiveGatewayWebhookInput,
  ReceiveGatewayWebhookResult,
} from "./receive-gateway-webhook";
export type {
  RecordOfflinePaymentInput,
  RecordOfflinePaymentResult,
  RequestOfflinePaymentProofUploadInput,
  RequestOfflinePaymentProofUploadResult,
} from "./record-offline-payment";
export type {
  ResolvePaymentReviewCaseInput,
  ResolvePaymentReviewCaseResult,
} from "./resolve-review-case";
export type {
  GetPaymentReviewCaseInput,
  GetPaymentReviewCaseResult,
  ListPaymentReviewCasesInput,
  ListPaymentReviewCasesResult,
  PaymentReviewCaseItem,
  PaymentReviewCaseView,
  PaymentReviewPayer,
} from "./review-cases";
export type {
  GetOfflinePaymentProofInput,
  GetOfflinePaymentProofResult,
} from "./offline-proof";
export type {
  GetPaymentBatchForStaffInput,
  GetPaymentBatchForStaffResult,
  StaffPaymentBatch,
} from "./staff-batch";
export type { SyncOutcome, WebhookOutcome } from "./domain/outcomes";
export type * from "./refunds";
export type {
  ConfirmCheckoutInput,
  ConfirmCheckoutResult,
} from "./confirm-checkout";
export type {
  FeesToPay,
  GetFeesToPayInput,
  GetFeesToPayResult,
} from "./get-fees-to-pay";
export type {
  GetPaymentBatchInput,
  GetPaymentBatchResult,
  PaymentBatchItemView,
  PaymentBatchView,
} from "./get-payment-batch";
export type { PaymentBatchStatus } from "./domain/batch-status";
export type {
  PayInstitutionFeesInput,
  PayInstitutionFeesResult,
} from "./pay-institution-fees";
export type {
  PayTestCheckoutInput,
  PayTestCheckoutResult,
} from "./pay-test-checkout";

export const paymentsUseCases = (ctx: UseCaseContext) => ({
  payInstitutionFees: (input: PayInstitutionFeesInput) =>
    payInstitutionFees(ctx, input),
  receiveGatewayWebhook: (input: ReceiveGatewayWebhookInput) =>
    receiveGatewayWebhook(ctx, input),
  confirmCheckout: (input: ConfirmCheckoutInput) => confirmCheckout(ctx, input),
  getPaymentBatch: (input: GetPaymentBatchInput) => getPaymentBatch(ctx, input),
  getFeesToPay: (input: GetFeesToPayInput) => getFeesToPay(ctx, input),
  payTestCheckout: (input: PayTestCheckoutInput) => payTestCheckout(ctx, input),
  // #79: offline payments and payments needing review.
  requestOfflinePaymentProofUpload: (
    input: RequestOfflinePaymentProofUploadInput
  ) => requestOfflinePaymentProofUpload(ctx, input),
  recordOfflinePayment: (input: RecordOfflinePaymentInput) =>
    recordOfflinePayment(ctx, input),
  listPaymentReviewCases: (input: ListPaymentReviewCasesInput) =>
    listPaymentReviewCases(ctx, input),
  getPaymentReviewCase: (input: GetPaymentReviewCaseInput) =>
    getPaymentReviewCase(ctx, input),
  resolvePaymentReviewCase: (input: ResolvePaymentReviewCaseInput) =>
    resolvePaymentReviewCase(ctx, input),
  recordDashboardRefund: (input: RecordDashboardRefundInput) =>
    recordDashboardRefund(ctx, input),
  getOfflinePaymentProof: (input: GetOfflinePaymentProofInput) =>
    getOfflinePaymentProof(ctx, input),
  getPaymentBatchForStaff: (input: GetPaymentBatchForStaffInput) =>
    getPaymentBatchForStaff(ctx, input),
  // #80: refunds.
  ...refundsUseCases(ctx),
});
