// Editing and publishing CMS documents (#111).
//
//   listCmsDocuments()               → content manager
//   listRevisions({ key })           → content manager
//   saveDraft({ key, body })         → content manager
//   publishRevision({ revisionId })  → content manager
//
// A document has at most one open draft, edited in place, and at most one
// published revision. Publishing numbers the draft and supersedes the one
// before, in one transaction; the database refuses any change to a
// published or superseded revision. Each use case returns the cache tags
// its Server Action passes to `updateTag`, so the public pages show a
// publish on the next request.
//
// Loads under plain Node: relative imports only.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { cmsRevision } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  CMS_DOCUMENT_KEYS,
  cmsDocumentKind,
  tagsToRefresh,
  type CmsDocumentKey,
  type CmsDocumentKind,
} from "./domain/documents";
import {
  decidePublish,
  decideSaveDraft,
  type CmsRevisionStatus,
} from "./domain/revisions";
import { kindOf } from "./kinds";
import { mirrorIntoConsent } from "./legal";
import {
  documentStates,
  ensureDocument,
  lockDocument,
  lockRevision,
  maxVersion,
  revisionInStatus,
  revisionsOf,
} from "./repository";

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

const keyInput = z.object({ key: z.enum(CMS_DOCUMENT_KEYS) });

const saveInput = z.object({
  key: z.enum(CMS_DOCUMENT_KEYS),
  body: z.unknown(),
});

const publishInput = z.object({ revisionId: z.uuid() });

/** Who a user column names: the signed-in user, or null for anyone else. */
function userIdOf(ctx: CmsContext): string | null {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}

function person(id: string | null, name: string | null) {
  return id !== null && name !== null ? { id, name } : null;
}

/** Every document, in registry order, with its draft and published state. */
export async function listCmsDocuments(
  ctx: CmsContext
): Promise<CmsDocumentSummary[]> {
  await authorize(ctx, "cms.read_drafts");
  const states = await documentStates(ctx.db);
  return CMS_DOCUMENT_KEYS.map((key) => {
    const published = states.find(
      (state) => state.key === key && state.status === "published"
    );
    return {
      key,
      kind: cmsDocumentKind(key),
      editable: kindOf(key) !== null,
      published:
        published?.version != null && published.publishedAt !== null
          ? { version: published.version, publishedAt: published.publishedAt }
          : null,
      hasDraft: states.some(
        (state) => state.key === key && state.status === "draft"
      ),
    };
  });
}

/** A document's revisions, newest first. */
export async function listRevisions(
  ctx: CmsContext,
  input: { key: CmsDocumentKey }
): Promise<ListRevisionsResult> {
  await authorize(ctx, "cms.read_drafts");
  const valid = keyInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const rows = await revisionsOf(ctx.db, valid.data.key);
  return {
    ok: true,
    revisions: rows.map((row) => ({
      id: row.id,
      status: row.status,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: person(row.creatorId, row.creatorName),
      publishedAt: row.publishedAt,
      publishedBy: person(row.publisherId, row.publisherName),
    })),
  };
}

/**
 * Saves `body` as the document's draft: sanitised, then checked against
 * its kind. Edits the open draft in place, or starts one.
 */
export async function saveDraft(
  ctx: CmsContext,
  input: { key: CmsDocumentKey; body: unknown }
): Promise<SaveDraftResult> {
  await authorize(ctx, "cms.save_draft");
  const valid = saveInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const { key } = valid.data;
  const kind = kindOf(key);
  if (!kind) return { ok: false, error: "not_editable" };
  const parsed = kind.parse(valid.data.body);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_body", issues: parsed.issues };
  }
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const document = await ensureDocument(tx, key, now);
    const decision = decideSaveDraft(
      await revisionInStatus(tx, document.id, "draft")
    );
    if (decision.action === "update") {
      await tx
        .update(cmsRevision)
        .set({ body: parsed.body, updatedAt: now })
        .where(eq(cmsRevision.id, decision.revisionId));
      return { ok: true, revisionId: decision.revisionId } as const;
    }
    const revisionId = uuidv7(now);
    await tx.insert(cmsRevision).values({
      id: revisionId,
      documentId: document.id,
      body: parsed.body,
      status: "draft",
      createdByUserId: userIdOf(ctx),
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, revisionId } as const;
  });
}

/**
 * Publishes a draft as its document's next version and supersedes the
 * published one, with one audit entry (ids, statuses and versions; never
 * the body).
 */
export async function publishRevision(
  ctx: CmsContext,
  input: { revisionId: string }
): Promise<PublishRevisionResult> {
  const { role } = await authorize(ctx, "cms.publish");
  const valid = publishInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const target = await lockRevision(tx, valid.data.revisionId);
    if (!target) return { ok: false, error: "not_found" } as const;
    await lockDocument(tx, target.documentId);
    const published = await revisionInStatus(
      tx,
      target.documentId,
      "published"
    );
    const decision = decidePublish({
      target,
      published,
      maxVersion: await maxVersion(tx, target.documentId),
    });
    if (!decision.ok) return { ok: false, error: decision.code } as const;
    const key = target.key as CmsDocumentKey;

    // Supersede first: the partial unique index allows one published row.
    if (decision.supersede) {
      await tx
        .update(cmsRevision)
        .set({ status: "superseded" })
        .where(eq(cmsRevision.id, decision.supersede));
    }
    await tx
      .update(cmsRevision)
      .set({
        status: "published",
        version: decision.version,
        publishedAt: now,
        publishedByUserId: userIdOf(ctx),
      })
      .where(eq(cmsRevision.id, target.id));
    await recordAudit(tx, ctx, {
      action: "cms_revision.published",
      entity: { type: "cms_revision", id: target.id },
      before: {
        documentKey: key,
        revisionId: target.id,
        status: target.status,
        published:
          published && published.version !== null
            ? { revisionId: published.id, version: published.version }
            : null,
      },
      after: {
        documentKey: key,
        revisionId: target.id,
        status: "published",
        version: decision.version,
      },
      actorRole: role,
    });
    const consentTags = await mirrorIntoConsent(tx, ctx, {
      key,
      revisionId: target.id,
      body: target.body,
      actorRole: role,
    });
    return {
      ok: true,
      version: decision.version,
      tags: [...tagsToRefresh(key), ...consentTags],
    } as const;
  });
}
