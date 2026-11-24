import type { UseCaseContext } from "../../use-cases";
import { declareParticipation } from "./declaration";
import { listSignedFormsForRegistration } from "./dashboard";
import { getConsentFormForReview, listConsentFormsForReview } from "./queue";
import { reviewConsentForm } from "./review";
import {
  requestConsentFormUpload,
  submitConsentForm,
  withdrawConsentForm,
} from "./submit";

export const consentFormUseCases = (ctx: UseCaseContext) => ({
  requestConsentFormUpload: (
    input: Parameters<typeof requestConsentFormUpload>[1]
  ) => requestConsentFormUpload(ctx, input),
  submitConsentForm: (input: Parameters<typeof submitConsentForm>[1]) =>
    submitConsentForm(ctx, input),
  withdrawConsentForm: (input: Parameters<typeof withdrawConsentForm>[1]) =>
    withdrawConsentForm(ctx, input),
  reviewConsentForm: (input: Parameters<typeof reviewConsentForm>[1]) =>
    reviewConsentForm(ctx, input),
  declareParticipation: (input: Parameters<typeof declareParticipation>[1]) =>
    declareParticipation(ctx, input),
  listSignedFormsForRegistration: (
    input: Parameters<typeof listSignedFormsForRegistration>[1]
  ) => listSignedFormsForRegistration(ctx, input),
  listConsentFormsForReview: (
    input: Parameters<typeof listConsentFormsForReview>[1]
  ) => listConsentFormsForReview(ctx, input),
  getConsentFormForReview: (
    input: Parameters<typeof getConsentFormForReview>[1]
  ) => getConsentFormForReview(ctx, input),
});
