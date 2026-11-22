// The CMS module (#111): the site's editable documents, their drafts and
// published revisions. Its use cases join `as(actor)` through
// `cmsUseCases`.

import type { UseCaseContext } from "../../use-cases";
import type { CmsDocumentKey } from "./domain/documents";
import { getOrgFacts, getOrgFactsForPreview, orgFactsReadiness } from "./facts";
import { currentLegalVersion } from "./legal";
import {
  checkPostWriter,
  createPost,
  getPostForEdit,
  listPosts,
  updatePost,
} from "./posts/drafts";
import {
  describePostImage,
  uploadPostImage,
  type UploadPostImageInput,
} from "./posts/images";
import type { PostInput } from "./posts/input";
import {
  archivePost,
  publishPost,
  restorePost,
  schedulePost,
  unschedulePost,
} from "./posts/publishing";
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

export type { OrgFacts } from "./domain/org-facts";
export type { OrgFactsReadiness } from "./facts";
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
export type {
  CreatePostResult,
  GetPostForEditResult,
  PostForEdit,
  PostImageSummary,
  PostSummary,
  UpdatePostResult,
} from "./posts/drafts";
export type {
  DescribePostImageResult,
  UploadPostImageInput,
  UploadPostImageResult,
} from "./posts/images";
export type {
  ArchivePostResult,
  PublishPostResult,
  RestorePostResult,
  SchedulePostResult,
  UnschedulePostResult,
} from "./posts/publishing";
export { POST_TAGS } from "./posts/cache-tags";
export type {
  PostInput,
  PostInputField,
  PostInputRefusal,
} from "./posts/input";

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
  getOrgFacts: () => getOrgFacts(ctx),
  getOrgFactsForPreview: () => getOrgFactsForPreview(ctx),
  orgFactsReadiness: () => orgFactsReadiness(ctx),
  // Blog posts and stories (#112).
  checkPostWriter: () => checkPostWriter(ctx),
  createPost: (input: PostInput) => createPost(ctx, input),
  updatePost: (input: PostInput & { postId: string }) => updatePost(ctx, input),
  getPostForEdit: (input: { postId: string }) => getPostForEdit(ctx, input),
  listPosts: () => listPosts(ctx),
  uploadPostImage: (input: UploadPostImageInput) => uploadPostImage(ctx, input),
  describePostImage: (input: { postImageId: string; alt: string }) =>
    describePostImage(ctx, input),
  schedulePost: (input: { postId: string; publishAt: Date | string }) =>
    schedulePost(ctx, input),
  unschedulePost: (input: { postId: string }) => unschedulePost(ctx, input),
  publishPost: (input: { postId: string }) => publishPost(ctx, input),
  archivePost: (input: { postId: string }) => archivePost(ctx, input),
  restorePost: (input: { postId: string }) => restorePost(ctx, input),
});
