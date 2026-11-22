// The participants module (#78): an adult takes part on their own. They
// register themselves for a competition (a profile of their own with an
// FOA Participant ID), pay its fee as a payment batch of one on the
// payments module's machinery (#77), and see their registrations on the
// participant dashboard. Its use cases join `as(actor)` through
// `participantsUseCases`. Minors and guardians arrive with #81.

import type { UseCaseContext } from "../../use-cases";
import {
  confirmMyPayment,
  type ConfirmMyPaymentInput,
} from "./confirm-my-payment";
import { listMyRegistrations } from "./list-my-registrations";
import {
  payForMyRegistration,
  type PayForMyRegistrationInput,
} from "./pay-for-my-registration";
import { individualRegistrationForm } from "./registration-form";
import {
  registerAsIndividual,
  type RegisterAsIndividualInput,
} from "./register-as-individual";

export type {
  ConfirmMyPaymentInput,
  ConfirmMyPaymentResult,
} from "./confirm-my-payment";
export type { IndividualRegistrationRefusal } from "./domain/individual-eligibility";
export type { MyRegistration } from "./list-my-registrations";
export type { IndividualRegistrationForm } from "./registration-form";
export type {
  PayForMyRegistrationInput,
  PayForMyRegistrationResult,
} from "./pay-for-my-registration";
export type {
  RegisterAsIndividualInput,
  RegisterAsIndividualResult,
} from "./register-as-individual";

export const participantsUseCases = (ctx: UseCaseContext) => ({
  registerAsIndividual: (input: RegisterAsIndividualInput) =>
    registerAsIndividual(ctx, input),
  payForMyRegistration: (input: PayForMyRegistrationInput) =>
    payForMyRegistration(ctx, input),
  confirmMyPayment: (input: ConfirmMyPaymentInput) =>
    confirmMyPayment(ctx, input),
  listMyRegistrations: () => listMyRegistrations(ctx),
  individualRegistrationForm: (input: { competitionSlug: string }) =>
    individualRegistrationForm(ctx, input),
});
