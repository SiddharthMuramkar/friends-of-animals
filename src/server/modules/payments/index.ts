// The payments module (#77): an institution pays its students' fees in
// one gateway order, and every signal from the gateway (the Checkout
// return, a webhook) is checked against the gateway's own record of the
// order before anything is confirmed. Its use cases join `as(actor)`
// through `paymentsUseCases`. The Razorpay adapter, the webhook route and
// the pages arrive with 77b.

import type { UseCaseContext } from "../../use-cases";
import {
  payInstitutionFees,
  type PayInstitutionFeesInput,
} from "./pay-institution-fees";

export type {
  PayInstitutionFeesInput,
  PayInstitutionFeesResult,
} from "./pay-institution-fees";

export const paymentsUseCases = (ctx: UseCaseContext) => ({
  payInstitutionFees: (input: PayInstitutionFeesInput) =>
    payInstitutionFees(ctx, input),
});
