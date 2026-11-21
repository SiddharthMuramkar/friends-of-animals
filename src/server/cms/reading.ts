// Reading CMS documents (#111).
//
//   getPublishedDocument({ key })  → anyone
//   getDraftForPreview({ key })    → content manager
//   startPreview({ key })          → content manager
//
// Loads under plain Node: relative imports only.

import type { InvalidInput } from "../input";
import type { CmsDocumentKey } from "./domain/documents";
import type { CmsContext } from "./publishing";

export type PublishedCmsDocument = {
  key: CmsDocumentKey;
  version: number;
  publishedAt: Date;
  body: unknown;
};

export type CmsDraftPreview = {
  revisionId: string;
  updatedAt: Date;
  body: unknown;
};

export type StartPreviewResult =
  | { ok: true; path: `/${string}` }
  | InvalidInput;

export async function getPublishedDocument(
  _ctx: CmsContext,
  _input: { key: CmsDocumentKey }
): Promise<PublishedCmsDocument | null> {
  throw new Error("getPublishedDocument is not built yet");
}

export async function getDraftForPreview(
  _ctx: CmsContext,
  _input: { key: CmsDocumentKey }
): Promise<CmsDraftPreview | null> {
  throw new Error("getDraftForPreview is not built yet");
}

export async function startPreview(
  _ctx: CmsContext,
  _input: { key: CmsDocumentKey }
): Promise<StartPreviewResult> {
  throw new Error("startPreview is not built yet");
}
