// Editing and publishing CMS documents (#111).
//
//   listCmsDocuments()               → content manager
//   listRevisions({ key })           → content manager
//   saveDraft({ key, body })         → content manager
//   publishRevision({ revisionId })  → content manager
//
// Loads under plain Node: relative imports only.

import type { InvalidInput } from "../input";
import type { UseCaseContext } from "../use-cases";
import type { CmsDocumentKey, CmsDocumentKind } from "./domain/documents";
import type { CmsRevisionStatus } from "./domain/revisions";

export type CmsContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

export type CmsDocumentSummary = {
  key: CmsDocumentKey;
  kind: CmsDocumentKind;
  /** Whether its kind has an editor yet. */
  editable: boolean;
  published: { version: number; publishedAt: Date } | null;
  hasDraft: boolean;
};

export type CmsRevisionSummary = {
  id: string;
  status: CmsRevisionStatus;
  version: number | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; name: string } | null;
  publishedAt: Date | null;
  publishedBy: { id: string; name: string } | null;
};

export type SaveDraftResult =
  | { ok: true; revisionId: string }
  | InvalidInput
  | { ok: false; error: "invalid_body"; issues: string[] }
  | { ok: false; error: "not_editable" };

export type PublishRevisionResult =
  | { ok: true; version: number; tags: string[] }
  | InvalidInput
  | { ok: false; error: "not_found" | "not_draft" };

export type ListRevisionsResult =
  | { ok: true; revisions: CmsRevisionSummary[] }
  | InvalidInput;

export async function listCmsDocuments(
  _ctx: CmsContext
): Promise<CmsDocumentSummary[]> {
  throw new Error("listCmsDocuments is not built yet");
}

export async function listRevisions(
  _ctx: CmsContext,
  _input: { key: CmsDocumentKey }
): Promise<ListRevisionsResult> {
  throw new Error("listRevisions is not built yet");
}

export async function saveDraft(
  _ctx: CmsContext,
  _input: { key: CmsDocumentKey; body: unknown }
): Promise<SaveDraftResult> {
  throw new Error("saveDraft is not built yet");
}

export async function publishRevision(
  _ctx: CmsContext,
  _input: { revisionId: string }
): Promise<PublishRevisionResult> {
  throw new Error("publishRevision is not built yet");
}
