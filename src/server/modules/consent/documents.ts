// Consent documents (#64): publishing a new version, and reading the
// current one and the history.
//
//   previewConsentDocument({ purpose, source })        → staff admin, super admin
//   publishConsentDocument({ purpose, title, source }) → staff admin, super admin
//   currentConsentDocument({ purpose })                → anyone
//   listConsentDocumentVersions({ purpose })           → staff admin, super admin
//
// A published version is never edited: publishing inserts the next one,
// and the database refuses any UPDATE or DELETE of consent_document. The
// privacy notice and the terms are their policy pages' text (#111): only
// publishing the page in the CMS publishes them, so preview and publish
// refuse both with `published_by_cms` and write nothing.
// Loads under plain Node: relative imports only.

import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  isLinkedConsentPurpose,
  isMirroredConsentPurpose,
  legalKeyForConsentPurpose,
} from "../cms/domain/documents";
import { publishedRevisionId } from "../cms/repository";
import type { ConsentDocumentBody } from "./domain/document-body";
import {
  parseConsentDocumentSource,
  type SourceError,
} from "./domain/document-source";
import { DOCUMENT_PURPOSES, type ConsentPurpose } from "./domain/purposes";
import { insertConsentDocumentVersion } from "./insert-version";
import { documentVersions, latestDocument } from "./repository";

export type ConsentContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

/** A published version, as anyone may read it. */
export type PublishedConsentDocument = {
  id: string;
  purpose: ConsentPurpose;
  version: number;
  title: string;
  body: ConsentDocumentBody;
  publishedAt: Date;
};

/**
 * A version as staff see it: with who published it, or null once that
 * account no longer exists.
 */
export type ConsentDocumentVersion = PublishedConsentDocument & {
  publishedBy: { id: string; name: string } | null;
};

export type PublishConsentDocumentInput = {
  purpose: ConsentPurpose;
  title: string;
  source: string;
};

export type PreviewConsentDocumentInput = {
  purpose: ConsentPurpose;
  source: string;
};

/** The privacy notice or the terms: only their page's CMS publish does. */
type PublishedByCms = { ok: false; error: "published_by_cms" };

export type PublishConsentDocumentResult =
  | { ok: true; id: string; version: number }
  | InvalidInput
  | PublishedByCms
  | { ok: false; error: "invalid_source"; errors: SourceError[] };

export type PreviewConsentDocumentResult =
  | { ok: true; body: ConsentDocumentBody }
  | PublishedByCms
  | { ok: false; error: "invalid_source"; errors: SourceError[] };

const purposeInput = z.object({ purpose: z.enum(DOCUMENT_PURPOSES) });

const previewInput = purposeInput.extend({
  source: z.string().max(100_000),
});

const publishInput = previewInput.extend({
  title: z.string().trim().min(1).max(200),
});

/**
 * What `source` would publish as the purpose's next version, for staff to
 * check before they do: the body, or its line-numbered errors. Saves
 * nothing.
 */
export async function previewConsentDocument(
  ctx: ConsentContext,
  input: PreviewConsentDocumentInput
): Promise<PreviewConsentDocumentResult> {
  await authorize(ctx, "consent_document.publish");
  const { purpose, source } = previewInput.parse(input);
  if (isMirroredConsentPurpose(purpose)) {
    return { ok: false, error: "published_by_cms" };
  }
  const parsed = parseConsentDocumentSource(source);
  return parsed.ok
    ? { ok: true, body: parsed.body }
    : { ok: false, error: "invalid_source", errors: parsed.errors };
}

/**
 * Publishes `source` as the next version of the purpose's document. The
 * older versions stay exactly as they were.
 */
export async function publishConsentDocument(
  ctx: ConsentContext,
  input: PublishConsentDocumentInput
): Promise<PublishConsentDocumentResult> {
  const { role } = await authorize(ctx, "consent_document.publish");
  const valid = publishInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const { purpose, title, source } = valid.data;
  if (isMirroredConsentPurpose(purpose)) {
    return { ok: false, error: "published_by_cms" };
  }
  const parsed = parseConsentDocumentSource(source);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_source", errors: parsed.errors };
  }
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const {
      id,
      version,
      previous: latest,
    } = await insertConsentDocumentVersion(
      tx,
      {
        now,
        publishedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      },
      {
        purpose,
        title,
        body: parsed.body,
        // The messages consent rests on the privacy page (#111): it
        // records the page's published revision, once there is one. A
        // competition's terms (#72) rest on no page.
        legalRevisionId: isLinkedConsentPurpose(purpose)
          ? await publishedRevisionId(tx, legalKeyForConsentPurpose(purpose))
          : null,
      }
    );
    await recordAudit(tx, ctx, {
      action: "consent_document.published",
      entity: { type: "consent_document", id },
      before: latest
        ? { documentId: latest.id, version: latest.version }
        : null,
      after: { documentId: id, purpose, version },
      actorRole: role,
    });
    return { ok: true, id, version } as const;
  });
}

/** The latest published version of a purpose's document, or null. */
export async function currentConsentDocument(
  ctx: ConsentContext,
  input: { purpose: ConsentPurpose }
): Promise<PublishedConsentDocument | null> {
  await authorize(ctx, "consent_document.view_current");
  const { purpose } = purposeInput.parse(input);
  return latestDocument(ctx.db, purpose);
}

/** Every published version of a purpose's document, newest first. */
export async function listConsentDocumentVersions(
  ctx: ConsentContext,
  input: { purpose: ConsentPurpose }
): Promise<ConsentDocumentVersion[]> {
  await authorize(ctx, "consent_document.list_versions");
  const { purpose } = purposeInput.parse(input);
  const rows = await documentVersions(ctx.db, purpose);
  return rows.map(({ publisherId, publisherName, ...document }) => ({
    ...document,
    publishedBy:
      publisherId !== null && publisherName !== null
        ? { id: publisherId, name: publisherName }
        : null,
  }));
}
