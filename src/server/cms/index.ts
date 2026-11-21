// The CMS module (#111): the site's editable documents, their drafts and
// published revisions. Its use cases join `as(actor)` through
// `cmsUseCases`.

import type { UseCaseContext } from "../use-cases";
import type { CmsDocumentKey } from "./domain/documents";
import { currentLegalVersion } from "./legal";
import {
  listCmsDocuments,
  listRevisions,
  publishRevision,
  saveDraft,
} from "./publishing";
import {
  getDraftForPreview,
  getPublishedDocument,
  startPreview,
} from "./reading";

export type { LegalVersion } from "./legal";
export type {
  CmsDraftPreview,
  PublishedCmsDocument,
  StartPreviewResult,
} from "./reading";
export type {
  CmsDocumentSummary,
  CmsRevisionSummary,
  ListRevisionsResult,
  PublishRevisionResult,
  SaveDraftResult,
} from "./publishing";
export type { CmsDocumentKey, CmsDocumentKind } from "./domain/documents";

export const cmsUseCases = (ctx: UseCaseContext) => ({
  listCmsDocuments: () => listCmsDocuments(ctx),
  listRevisions: (input: { key: CmsDocumentKey }) => listRevisions(ctx, input),
  saveDraft: (input: { key: CmsDocumentKey; body: unknown }) =>
    saveDraft(ctx, input),
  publishRevision: (input: { revisionId: string }) =>
    publishRevision(ctx, input),
  getPublishedDocument: (input: { key: CmsDocumentKey }) =>
    getPublishedDocument(ctx, input),
  getDraftForPreview: (input: { key: CmsDocumentKey }) =>
    getDraftForPreview(ctx, input),
  startPreview: (input: { key: CmsDocumentKey }) => startPreview(ctx, input),
  currentLegalVersion: (input: { key: CmsDocumentKey }) =>
    currentLegalVersion(ctx, input),
});
