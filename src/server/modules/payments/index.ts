// The payments module (#77): an institution pays its students' fees in
// one gateway order, and every signal from the gateway (the Checkout
// return, a webhook) is checked against the gateway's own record of the
// order before anything is confirmed. Its use cases join `as(actor)`
// through `paymentsUseCases`. The adapters live in src/server/ports, the
// webhook route in src/app/api/webhooks and the pay pages under
// src/app/institution/registrations/[ref].

import type { UseCaseContext } from "../../use-cases";
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
});
