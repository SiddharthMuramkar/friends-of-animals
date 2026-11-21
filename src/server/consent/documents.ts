// Consent documents (#64): publishing a new version, and reading the
// current one and the history.
//
//   publishConsentDocument({ purpose, title, source }) → staff admin, super admin
//   currentConsentDocument({ purpose })                → anyone
//   listConsentDocumentVersions({ purpose })           → staff admin, super admin
//
// A published version is never edited: publishing inserts the next one,
// and the database refuses any UPDATE or DELETE of consent_document.
// Loads under plain Node: relative imports only.

import { z } from "zod";

import { authorize } from "../access/can";
import { recordAudit } from "../audit/record";
import { consentDocument } from "../db/schema";
import { uuidv7 } from "../ids";
import { invalidInput, type InvalidInput } from "../input";
import type { UseCaseContext } from "../use-cases";
import type { ConsentDocumentBody } from "./domain/document-body";
import {
  parseConsentDocumentSource,
  type SourceError,
} from "./domain/document-source";
import { CONSENT_PURPOSES, type ConsentPurpose } from "./domain/purposes";
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

/** A version as staff see it: with who published it (null for seed data). */
export type ConsentDocumentVersion = PublishedConsentDocument & {
  publishedBy: { id: string; name: string } | null;
};

export type PublishConsentDocumentInput = {
  purpose: ConsentPurpose;
  title: string;
  source: string;
};

export type PublishConsentDocumentResult =
  | { ok: true; id: string; version: number }
  | InvalidInput
  | { ok: false; error: "invalid_source"; errors: SourceError[] };

const purposeInput = z.object({ purpose: z.enum(CONSENT_PURPOSES) });

const publishInput = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  title: z.string().trim().min(1).max(200),
  source: z.string().max(100_000),
});

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
  const parsed = parseConsentDocumentSource(source);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_source", errors: parsed.errors };
  }
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const latest = await latestDocument(tx, purpose);
    const id = uuidv7(now);
    const version = (latest?.version ?? 0) + 1;
    await tx.insert(consentDocument).values({
      id,
      purpose,
      version,
      title,
      body: parsed.body,
      publishedAt: now,
      publishedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
    });
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
