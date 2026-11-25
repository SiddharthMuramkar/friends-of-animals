// The consent module (#64): versioned consent documents, and consent given
// and withdrawn as an event log. A verified guardian gives and withdraws
// each purpose for a child on its own (#82). Its use cases join
// `as(actor)` through `consentUseCases`.

import {
  myPublicUseConsents,
  withdrawMyPublicUseConsent,
  type OwnPublicPurpose,
} from "./own-public-use";
import { myAuctionConsents, withdrawMyAuctionConsent } from "./own-auction";
import type { UseCaseContext } from "../../use-cases";
import {
  childConsentHistory,
  childConsents,
  giveChildConsent,
  withdrawChildConsent,
  type GiveChildConsentInput,
  type WithdrawChildConsentInput,
} from "./child-consent";
import {
  giveConsent,
  myConsents,
  withdrawConsent,
  type GiveConsentInput,
} from "./consents";
import {
  currentConsentDocument,
  listConsentDocumentVersions,
  previewConsentDocument,
  publishConsentDocument,
  type PreviewConsentDocumentInput,
  type PublishConsentDocumentInput,
} from "./documents";
import type { ConsentPurpose, GivablePurpose } from "./domain/purposes";

export type {
  ConsentHistoryItem,
  GiveConsentInput,
  GiveConsentResult,
  MyConsent,
  SignUpConsentOutcome,
  WithdrawConsentResult,
} from "./consents";
// Not a use case: it has no can() of its own. Only identity's
// createAccount calls it, inside the transaction that makes the account,
// after verifyEmailCode has authorized the visitor. Any other caller
// must authorize first.
export { recordSignUpConsent } from "./consents";
// Not a use case either: registerAsIndividual (#78) calls it inside the
// transaction that saves the registration, after authorizing the member.
export { recordRegistrationConsents } from "./consents";
// Not a use case either (#126): a campaign message's withdrawal link calls
// it, after authorizing the link's holder.
export { withdrawByMessageLink, type MessageLinkConsent } from "./consents";
export {
  giveChildConsentInput,
  publicUse,
  withdrawChildConsentInput,
} from "./child-consent";
// Not use cases either (#82): the registration use cases call them inside
// their transactions, after authorizing their actor.
export {
  participationRefusals,
  participationGiven,
  recordChildParticipation,
  releaseHeldRegistrations,
} from "./participation-gate";
export type {
  ChildConsentDocument,
  ChildConsentHistory,
  ChildConsentHistoryItem,
  ChildConsentPurpose,
  ChildConsents,
  GiveChildConsentInput,
  GiveChildConsentResult,
  WithdrawChildConsentInput,
  WithdrawChildConsentResult,
} from "./child-consent";
export type { ConsentState } from "./domain/consent-state";
export { schoolParticipationUse } from "./school-route-use";
export type { GuardianPurpose, PublicUse } from "./domain/guardian-purposes";
export type { PublicCredit } from "./domain/public-credit";
export type {
  ConsentDocumentVersion,
  PreviewConsentDocumentInput,
  PreviewConsentDocumentResult,
  PublishConsentDocumentInput,
  PublishConsentDocumentResult,
  PublishedConsentDocument,
} from "./documents";
export type { ConsentDocumentBody } from "./domain/document-body";
export type { SourceError, SourceErrorCode } from "./domain/document-source";
export type { ConsentPurpose, GivablePurpose } from "./domain/purposes";

export const consentUseCases = (ctx: UseCaseContext) => ({
  previewConsentDocument: (input: PreviewConsentDocumentInput) =>
    previewConsentDocument(ctx, input),
  publishConsentDocument: (input: PublishConsentDocumentInput) =>
    publishConsentDocument(ctx, input),
  currentConsentDocument: (input: { purpose: ConsentPurpose }) =>
    currentConsentDocument(ctx, input),
  listConsentDocumentVersions: (input: { purpose: ConsentPurpose }) =>
    listConsentDocumentVersions(ctx, input),
  giveConsent: (input: GiveConsentInput) => giveConsent(ctx, input),
  withdrawConsent: (input: { purpose: GivablePurpose }) =>
    withdrawConsent(ctx, input),
  myConsents: () => myConsents(ctx),
  myAuctionConsents: () => myAuctionConsents(ctx),
  myPublicUseConsents: () => myPublicUseConsents(ctx),
  withdrawMyPublicUseConsent: (input: {
    competitionId: string;
    purpose: OwnPublicPurpose;
  }) => withdrawMyPublicUseConsent(ctx, input),
  withdrawMyAuctionConsent: (input: { competitionId: string }) =>
    withdrawMyAuctionConsent(ctx, input),
  childConsents: (input: { childId: string }) => childConsents(ctx, input),
  giveChildConsent: (input: GiveChildConsentInput) =>
    giveChildConsent(ctx, input),
  withdrawChildConsent: (input: WithdrawChildConsentInput) =>
    withdrawChildConsent(ctx, input),
  childConsentHistory: (input: { childId: string }) =>
    childConsentHistory(ctx, input),
});
