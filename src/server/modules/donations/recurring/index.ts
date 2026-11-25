import type { UseCaseContext } from "../../../use-cases";
import {
  startRecurringDonation,
  type StartRecurringDonationInput,
} from "./start";
import {
  getMyRecurringDonation,
  listMyRecurringDonations,
  listRecurringDonations,
} from "./list";
import { confirmRecurringCheckout, payRecurringTestCheckout } from "./confirm";
import {
  cancelRecurringDonation,
  expireAbandonedRecurringDonations,
} from "./cancel";
export const recurringUseCases = (ctx: UseCaseContext) => ({
  cancelRecurringDonation: (input: { id: string }) =>
    cancelRecurringDonation(ctx, input),
  expireAbandonedRecurringDonations: () =>
    expireAbandonedRecurringDonations(ctx),
  confirmRecurringCheckout: (input: {
    id: string;
    paymentId: string;
    signature: string;
  }) => confirmRecurringCheckout(ctx, input),
  payRecurringTestCheckout: (input: { id: string }) =>
    payRecurringTestCheckout(ctx, input),
  startRecurringDonation: (input: StartRecurringDonationInput) =>
    startRecurringDonation(ctx, input),
  getMyRecurringDonation: (input: { id: string }) =>
    getMyRecurringDonation(ctx, input),
  listMyRecurringDonations: () => listMyRecurringDonations(ctx),
  listRecurringDonations: () => listRecurringDonations(ctx),
});
