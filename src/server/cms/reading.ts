// Reading CMS documents (#111).
//
//   getPublishedDocument({ key })  → anyone
//   getDraftForPreview({ key })    → content manager
//   startPreview({ key })          → content manager
//
// Every body passes through its kind's sanitiser on the way out too, so a
// row that reached the table some other way (an import, an old version of
// the sanitiser, a raw insert) still renders only safe text.
//
// Loads under plain Node: relative imports only.

import { z } from "zod";

import { authorize } from "../access/can";
import { invalidInput, type InvalidInput } from "../input";
import {
  CMS_DOCUMENT_KEYS,
  cmsPublicPath,
  type CmsDocumentKey,
} from "./domain/documents";
import { kindOf } from "./kinds";
import type { CmsContext } from "./publishing";
import { revisionBodyOf } from "./repository";

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

const keyInput = z.object({ key: z.enum(CMS_DOCUMENT_KEYS) });

/**
 * The published revision of a document, sanitised, or null while none is
 * published (or its kind isn't built yet, so nothing could render it).
 */
export async function getPublishedDocument(
  ctx: CmsContext,
  input: { key: CmsDocumentKey }
): Promise<PublishedCmsDocument | null> {
  await authorize(ctx, "cms.read_published");
  const { key } = keyInput.parse(input);
  const kind = kindOf(key);
  const row = kind ? await revisionBodyOf(ctx.db, key, "published") : null;
  if (!kind || !row || row.version === null || row.publishedAt === null) {
    return null;
  }
  return {
    key,
    version: row.version,
    publishedAt: row.publishedAt,
    body: kind.sanitize(row.body),
  };
}

/** A document's open draft, sanitised, for its preview; or null. */
export async function getDraftForPreview(
  ctx: CmsContext,
  input: { key: CmsDocumentKey }
): Promise<CmsDraftPreview | null> {
  await authorize(ctx, "cms.read_drafts");
  const { key } = keyInput.parse(input);
  const kind = kindOf(key);
  const row = kind ? await revisionBodyOf(ctx.db, key, "draft") : null;
  if (!kind || !row) return null;
  return {
    revisionId: row.id,
    updatedAt: row.updatedAt,
    body: kind.sanitize(row.body),
  };
}

/**
 * Whether the actor may preview drafts, and the public page to preview
 * `key` on. Its Server Action turns Draft Mode on only after this allows.
 */
export async function startPreview(
  ctx: CmsContext,
  input: { key: CmsDocumentKey }
): Promise<StartPreviewResult> {
  await authorize(ctx, "cms.read_drafts");
  const valid = keyInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  return { ok: true, path: cmsPublicPath(valid.data.key) };
}
