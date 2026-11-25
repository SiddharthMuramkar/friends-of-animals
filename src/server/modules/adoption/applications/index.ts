// Adoption applications and the coordinator's workflow (#130): applying,
// the coordinator's review, contact and outcome, the listing
// organisation's view, and success stories. Its use cases join
// `as(actor)` through `adoptionApplicationsUseCases`.

import type { UseCaseContext } from "../../../use-cases";
import {
  adoptionApplicationForm,
  applyToAdopt,
  type ApplyToAdoptInput,
} from "./apply";
import {
  putAdopterInContact,
  recordAdoptionOutcome,
  startAdoptionReview,
  type AdoptionOutcome,
} from "./coordinator";
import {
  getAdoptionApplication,
  listAdoptionApplications,
  listApplicationsForAdoptionListing,
  myAdoptionApplication,
  myAdoptionApplications,
} from "./read";
import {
  listPublishedSuccessStories,
  publishSuccessStory,
  submitSuccessStory,
  withdrawSuccessStoryConsent,
} from "./stories";
import { withdrawAdoptionApplication } from "./withdraw";

export type {
  AdoptionApplicationForm,
  ApplyToAdoptInput,
  ApplyToAdoptResult,
} from "./apply";
export type { AdoptionOutcome, CoordinatorMoveResult } from "./coordinator";
export type {
  AdoptionApplicationSummary,
  AdoptionStoryView,
  CoordinatorApplicationSummary,
  CoordinatorApplicationView,
  ListApplicationsForAdoptionListingResult,
  MyAdoptionApplication,
  OwnerApplicationView,
} from "./read";
export type {
  PublishedSuccessStory,
  PublishSuccessStoryResult,
  SubmitSuccessStoryResult,
  WithdrawSuccessStoryConsentResult,
} from "./stories";
export type { WithdrawAdoptionApplicationResult } from "./withdraw";

export const adoptionApplicationsUseCases = (ctx: UseCaseContext) => ({
  adoptionApplicationForm: (input: { slug: string }) =>
    adoptionApplicationForm(ctx, input),
  applyToAdopt: (input: ApplyToAdoptInput) => applyToAdopt(ctx, input),
  withdrawAdoptionApplication: (input: { applicationId: string }) =>
    withdrawAdoptionApplication(ctx, input),
  myAdoptionApplications: () => myAdoptionApplications(ctx),
  myAdoptionApplication: (input: { applicationId: string }) =>
    myAdoptionApplication(ctx, input),
  listAdoptionApplications: (input?: { status?: string }) =>
    listAdoptionApplications(ctx, input),
  getAdoptionApplication: (input: { applicationId: string }) =>
    getAdoptionApplication(ctx, input),
  startAdoptionReview: (input: { applicationId: string }) =>
    startAdoptionReview(ctx, input),
  putAdopterInContact: (input: { applicationId: string }) =>
    putAdopterInContact(ctx, input),
  recordAdoptionOutcome: (input: {
    applicationId: string;
    outcome: AdoptionOutcome;
    reason?: string | null;
  }) => recordAdoptionOutcome(ctx, input),
  listApplicationsForAdoptionListing: (input: { adoptionListingId: string }) =>
    listApplicationsForAdoptionListing(ctx, input),
  submitSuccessStory: (input: {
    applicationId: string;
    body: string;
    consentDocumentId: string;
  }) => submitSuccessStory(ctx, input),
  publishSuccessStory: (input: { applicationId: string }) =>
    publishSuccessStory(ctx, input),
  withdrawSuccessStoryConsent: (input: { applicationId: string }) =>
    withdrawSuccessStoryConsent(ctx, input),
  listPublishedSuccessStories: () => listPublishedSuccessStories(ctx),
});
