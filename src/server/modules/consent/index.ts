// The consent module (#64): versioned consent documents, and consent given
// and withdrawn as an event log. Its use cases join `as(actor)` through
// `consentUseCases`.

import type { UseCaseContext } from "../../use-cases";
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
export type { ConsentState } from "./domain/consent-state";
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
});
