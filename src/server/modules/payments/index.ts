// The payments module (#77): an institution pays its students' fees in
// one gateway order, and every signal from the gateway (the Checkout
// return, a webhook) is checked against the gateway's own record of the
// order before anything is confirmed. Its use cases join `as(actor)`
// through `paymentsUseCases`. The Razorpay adapter, the webhook route and
// the pages arrive with 77b.

import type { UseCaseContext } from "../../use-cases";
import { confirmCheckout, type ConfirmCheckoutInput } from "./confirm-checkout";
import { getPaymentBatch } from "./get-payment-batch";
import {
  payInstitutionFees,
  type PayInstitutionFeesInput,
} from "./pay-institution-fees";
import {
  receiveGatewayWebhook,
  type ReceiveGatewayWebhookInput,
} from "./receive-gateway-webhook";

export type {
  ReceiveGatewayWebhookInput,
  ReceiveGatewayWebhookResult,
} from "./receive-gateway-webhook";
export type { SyncOutcome, WebhookOutcome } from "./domain/outcomes";
export type {
  ConfirmCheckoutInput,
  ConfirmCheckoutResult,
} from "./confirm-checkout";
export type {
  GetPaymentBatchResult,
  PaymentBatchItemView,
  PaymentBatchView,
} from "./get-payment-batch";
export type { PaymentBatchStatus } from "./domain/batch-status";
export type {
  PayInstitutionFeesInput,
  PayInstitutionFeesResult,
} from "./pay-institution-fees";

export const paymentsUseCases = (ctx: UseCaseContext) => ({
  payInstitutionFees: (input: PayInstitutionFeesInput) =>
    payInstitutionFees(ctx, input),
  receiveGatewayWebhook: (input: ReceiveGatewayWebhookInput) =>
    receiveGatewayWebhook(ctx, input),
  confirmCheckout: (input: ConfirmCheckoutInput) => confirmCheckout(ctx, input),
  getPaymentBatch: (input: { institutionId: string; batchId: string }) =>
    getPaymentBatch(ctx, input),
});
