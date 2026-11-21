// The consent module (#64): versioned consent documents, and consent given
// and withdrawn as an event log. Its use cases join `as(actor)` through
// `consentUseCases`.

import type { UseCaseContext } from "../use-cases";
import {
  currentConsentDocument,
  listConsentDocumentVersions,
  publishConsentDocument,
  type PublishConsentDocumentInput,
} from "./documents";
import type { ConsentPurpose } from "./domain/purposes";

export type {
  ConsentDocumentVersion,
  PublishConsentDocumentInput,
  PublishConsentDocumentResult,
  PublishedConsentDocument,
} from "./documents";
export type { ConsentDocumentBody } from "./domain/document-body";
export type { SourceError, SourceErrorCode } from "./domain/document-source";
export type { ConsentPurpose } from "./domain/purposes";

export const consentUseCases = (ctx: UseCaseContext) => ({
  publishConsentDocument: (input: PublishConsentDocumentInput) =>
    publishConsentDocument(ctx, input),
  currentConsentDocument: (input: { purpose: ConsentPurpose }) =>
    currentConsentDocument(ctx, input),
  listConsentDocumentVersions: (input: { purpose: ConsentPurpose }) =>
    listConsentDocumentVersions(ctx, input),
});
