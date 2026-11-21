// The legal pages in the CMS (#111): their current version, and the
// consent documents that rest on them.
//
//   currentLegalVersion({ key })  → anyone
//
// The CMS is the one editor of the four policy pages. Publishing the
// privacy or terms page publishes the next privacy notice or terms
// consent document with the same body, linked to the revision, in the same
// transaction, so the page and what people consent to can't drift apart.
// Consent documents stay insert-only.
//
// Loads under plain Node: relative imports only.

import { z } from "zod";

import type { Role } from "../access/domain/roles";
import { authorize } from "../access/can";
import { recordAudit } from "../audit/record";
import { parseConsentDocumentBody } from "../consent/domain/document-body";
import { insertConsentDocumentVersion } from "../consent/insert-version";
import { consentDocumentTag } from "../consent/tags";
import type { AppDb } from "../db/app-db";
import {
  CMS_DOCUMENT_KEYS,
  cmsDocumentKind,
  mirroredConsentPurpose,
  type CmsDocumentKey,
} from "./domain/documents";
import type { CmsContext } from "./publishing";
import { revisionBodyOf } from "./repository";

export type LegalVersion = { version: number; publishedAt: Date };

const LEGAL_KEYS = CMS_DOCUMENT_KEYS.filter(
  (key) => cmsDocumentKind(key) === "legal"
);

const legalKeyInput = z.object({
  key: z.enum(LEGAL_KEYS as [CmsDocumentKey, ...CmsDocumentKey[]]),
});

/** The version number and date a policy page shows, or null before v1. */
export async function currentLegalVersion(
  ctx: CmsContext,
  input: { key: CmsDocumentKey }
): Promise<LegalVersion | null> {
  await authorize(ctx, "cms.read_published");
  const { key } = legalKeyInput.parse(input);
  const row = await revisionBodyOf(ctx.db, key, "published");
  return row?.version != null && row.publishedAt !== null
    ? { version: row.version, publishedAt: row.publishedAt }
    : null;
}

/**
 * When `key` is the privacy or terms page, publishes the consent document
 * it mirrors, in the caller's transaction, with its own audit entry.
 * Returns the cache tags that publish adds.
 */
export async function mirrorIntoConsent(
  tx: AppDb,
  ctx: CmsContext,
  published: {
    key: CmsDocumentKey;
    revisionId: string;
    body: unknown;
    actorRole: Role | null;
  }
): Promise<string[]> {
  const purpose = mirroredConsentPurpose(published.key);
  if (!purpose) return [];
  const parsed = parseConsentDocumentBody(published.body);
  if (!parsed.ok) {
    // Saving checked the body against the consent document's own rules.
    throw new Error(
      `${published.key} revision ${published.revisionId} is not a valid consent document body`
    );
  }
  const { id, version, previous } = await insertConsentDocumentVersion(
    tx,
    {
      now: ctx.clock.now(),
      publishedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
    },
    {
      purpose,
      title: null,
      body: parsed.body,
      legalRevisionId: published.revisionId,
    }
  );
  await recordAudit(tx, ctx, {
    action: "consent_document.published",
    entity: { type: "consent_document", id },
    before: previous
      ? { documentId: previous.id, version: previous.version }
      : null,
    after: {
      documentId: id,
      purpose,
      version,
      legalRevisionId: published.revisionId,
    },
    actorRole: published.actorRole,
  });
  return [consentDocumentTag(purpose)];
}
