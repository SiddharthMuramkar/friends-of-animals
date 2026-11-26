// An access request's data export (#115b).
//
//   buildSubjectExport({ id })    the grievance officer asks for it, on a
//                                 started access request
//   privacy.build_export          the worker collects the person's data
//                                 (./collect.ts), stores it as a ZIP in the
//                                 private bucket and completes the request
//   getPrivacyExportLink({ id })  whoever filed the request gets a
//                                 5-minute download URL, until the link
//                                 expires (privacy.exportLinkHours)
//   privacy.expire_export         delayed to that moment: deletes the ZIP
//
// Staff never download a person's export: only the requester's use case
// signs a URL for it, and the Files module never sees it (its file.read
// rule lets staff admins open any upload). The archive holds `data.json`,
// a short README.txt, and the person's own uploads under files/.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../../access/can";
import type { Actor } from "../../../../actor";
import { recordAudit } from "../../../../audit/record";
import type { AppDb } from "../../../../db/app-db";
import { privacyRequest, type PrivacyRequestRow } from "../../../../db/schema";
import { DomainError } from "../../../../errors";
import { invalidInput, type InvalidInput } from "../../../../input";
import { emit, type OutboxDeps } from "../../../../outbox";
import type { UseCaseContext } from "../../../../use-cases";
import { readSetting } from "../../../settings/read";
import { privacyRequestAuditSnapshot } from "../domain/audit";
import {
  decideRequestTransition,
  type RequestTransitionRefusal,
} from "../domain/request-status";
import { decideExportLink, type ExportLinkRefusal } from "../export-view";
import { lockRequest, NOT_FOUND, withOfficer } from "../with-officer";
import { collectSubjectData } from "./collect";
import { subjectScope } from "./scope";
import { zipStore } from "./zip";

const HOUR_MS = 60 * 60 * 1000;

/** How long a signed download URL works once issued. */
export const EXPORT_URL_SECONDS = 5 * 60;

const WORKER: Actor = { kind: "system", process: "worker" };

const idInput = z.strictObject({ id: z.uuid() });

const README = `Friends of Animals: a copy of your data
========================================

data.json holds the records Friends of Animals keeps about the person this
request is about, one section per kind of record. "references" lists other
records that name the account (for example a record someone created), by
their id. "notIncluded" lists the kinds of record left out of this copy, and
why: another person's confidential report, a sign-in secret, a test message.

files/ holds the person's own uploads: pictures of their entries and signed
consent forms.

For auction payments, gateway_webhook_event lists the local payment batch
and the time by which a signed provider event reported capture. This is not
a separate finding of the exact capture time or a decision to accept the
payment. See payment_batch and payment_review_case for the financial
outcome. Internal gateway identifiers and fingerprints are not included
with auction payment records.

If something here is wrong, you can ask for a correction from your
dashboard on the Friends of Animals website.
`;

/** Where an export's ZIP lives: never a key an upload URL names. */
export function exportStorageKey(keyPrefix: string, requestId: string) {
  return `${keyPrefix}privacy_export/${requestId}.zip`;
}

export type BuildSubjectExportResult =
  | { ok: true }
  | InvalidInput
  | {
      ok: false;
      error:
        | RequestTransitionRefusal
        | "not_found"
        | "not_access"
        | "already_requested";
    };

/** The officer asks the worker to build a started access request's export. */
export async function buildSubjectExport(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<BuildSubjectExportResult> {
  return withOfficer<BuildSubjectExportResult>(
    ctx,
    "privacy_request.build_export",
    async (tx) => {
      const parsed = idInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const row = await lockRequest(tx, parsed.data.id);
      if (!row) return { result: NOT_FOUND };
      if (row.type !== "access") {
        return { result: { ok: false, error: "not_access" } as const };
      }
      const decision = decideRequestTransition({
        from: row.status,
        event: "complete",
        type: row.type,
      });
      if (!decision.ok) {
        return { result: { ok: false, error: decision.reason } as const };
      }
      if (row.exportRequestedAt !== null) {
        return { result: { ok: false, error: "already_requested" } as const };
      }
      const now = ctx.clock.now();
      const [updated] = await tx
        .update(privacyRequest)
        .set({ exportRequestedAt: now, updatedAt: now })
        .where(eq(privacyRequest.id, row.id))
        .returning();
      await emit(tx, ctx.clock, {
        type: "privacy_request.export_requested",
        aggregate: { type: "privacy_request", id: row.id },
        payload: { requestId: row.id },
      });
      return {
        result: { ok: true } as const,
        audit: {
          action: "privacy_request.export_requested",
          entity: { type: "privacy_request", id: row.id },
          before: privacyRequestAuditSnapshot(row),
          after: privacyRequestAuditSnapshot(updated!),
        },
      };
    }
  );
}

export type ExportJobDeps = Pick<
  OutboxDeps,
  "db" | "clock" | "cipher" | "storage" | "files" | "settings"
>;

async function currentRequest(
  db: AppDb,
  id: string
): Promise<PrivacyRequestRow | undefined> {
  const [row] = await db
    .select()
    .from(privacyRequest)
    .where(eq(privacyRequest.id, id));
  return row;
}

/**
 * The worker's job: collect, pack, store, then complete the request and
 * schedule the deletion. Safe to repeat: a request that is no longer
 * waiting for its export is left alone, and a ZIP stored for a request
 * that moved on meanwhile is deleted again.
 */
export async function runBuildExport(
  deps: ExportJobDeps,
  payload: { requestId: string }
): Promise<void> {
  const ctx = { ...deps, actor: WORKER };
  await authorize(ctx, "privacy_request.run_jobs");
  const waiting = (row: PrivacyRequestRow | undefined) =>
    row !== undefined &&
    row.status === "in_progress" &&
    row.exportRequestedAt !== null &&
    row.exportReadyAt === null;

  const row = await currentRequest(deps.db, payload.requestId);
  if (!waiting(row)) return;
  const now = deps.clock.now();
  const { document, files } = await collectSubjectData(deps, {
    scope: await subjectScope(deps.db, row!),
    subject: { kind: row!.subjectKind, id: row!.subjectId },
    reference: row!.reference,
    generatedAt: now,
  });
  const archive = zipStore(
    [
      { name: "README.txt", bytes: new TextEncoder().encode(README) },
      {
        name: "data.json",
        bytes: new TextEncoder().encode(JSON.stringify(document, null, 2)),
      },
      ...files,
    ],
    { modifiedAt: now }
  );
  if (deps.files.keyPrefix === null) {
    throw new Error("The database has no storage prefix for exports");
  }
  const key = exportStorageKey(deps.files.keyPrefix, row!.id);
  await deps.storage.write({
    bucket: deps.files.bucket,
    key,
    body: archive,
    contentType: "application/zip",
  });

  const stored = await deps.db.transaction(async (tx) => {
    const locked = await lockRequest(tx, payload.requestId);
    if (!waiting(locked)) return false;
    const hours = await readSetting(tx, "privacy.exportLinkHours");
    const readyAt = deps.clock.now();
    const expiresAt = new Date(readyAt.getTime() + hours * HOUR_MS);
    const [updated] = await tx
      .update(privacyRequest)
      .set({
        status: "completed",
        exportStorageKey: key,
        exportReadyAt: readyAt,
        exportExpiresAt: expiresAt,
        closedAt: readyAt,
        updatedAt: readyAt,
      })
      .where(eq(privacyRequest.id, locked!.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: "privacy_request.completed",
      entity: { type: "privacy_request", id: locked!.id },
      before: privacyRequestAuditSnapshot(locked!),
      after: privacyRequestAuditSnapshot(updated!),
      actorRole: null,
    });
    await emit(tx, deps.clock, {
      type: "privacy_request.completed",
      aggregate: { type: "privacy_request", id: locked!.id },
      payload: { requestId: locked!.id },
    });
    await emit(
      tx,
      deps.clock,
      {
        type: "privacy_request.export_expired",
        aggregate: { type: "privacy_request", id: locked!.id },
        payload: { requestId: locked!.id },
      },
      { availableAt: expiresAt }
    );
    return true;
  });
  if (!stored) await deps.storage.delete({ bucket: deps.files.bucket, key });
}

/** Deletes an export once its link has expired. Safe to repeat. */
export async function runExpireExport(
  deps: ExportJobDeps,
  payload: { requestId: string }
): Promise<void> {
  const ctx = { ...deps, actor: WORKER };
  await authorize(ctx, "privacy_request.run_jobs");
  const row = await currentRequest(deps.db, payload.requestId);
  if (!row || row.exportStorageKey === null || row.exportDeletedAt !== null) {
    return;
  }
  await deps.storage.delete({
    bucket: deps.files.bucket,
    key: row.exportStorageKey,
  });
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const locked = await lockRequest(tx, row.id);
    if (!locked || locked.exportDeletedAt !== null) return;
    await tx
      .update(privacyRequest)
      .set({ exportDeletedAt: now, updatedAt: now })
      .where(eq(privacyRequest.id, row.id));
    await recordAudit(tx, ctx, {
      action: "privacy_request.export_deleted",
      entity: { type: "privacy_request", id: row.id },
      before: null,
      after: privacyRequestAuditSnapshot(locked),
      actorRole: null,
    });
  });
}

export type GetPrivacyExportLinkResult =
  | { ok: true; url: string; expiresAt: Date }
  | InvalidInput
  | { ok: false; error: ExportLinkRefusal };

/**
 * A short-lived download URL for the export, for whoever filed the
 * request. Anyone else, staff included, is refused as forbidden.
 */
export async function getPrivacyExportLink(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<GetPrivacyExportLinkResult> {
  const parsed = idInput.safeParse(input);
  const userId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
  const row =
    parsed.success && userId !== null
      ? await currentRequest(ctx.db, parsed.data.id)
      : undefined;
  const filedByActor =
    row !== undefined && userId !== null && row.requestedByUserId === userId;
  await authorize(
    ctx,
    "privacy_request.download_export",
    filedByActor ? { ownerId: userId } : {}
  );
  if (!row) throw new DomainError("forbidden", "Not this user's request");
  const link = decideExportLink(row, ctx.clock.now());
  if (!link.ok) return { ok: false, error: link.reason };
  const { url } = await ctx.storage.presignGet({
    bucket: ctx.files.bucket,
    key: link.storageKey,
    expiresInSeconds: EXPORT_URL_SECONDS,
    contentType: "application/zip",
    disposition: "attachment",
    filename: `foa-data-${row.reference}.zip`,
  });
  await ctx.db.transaction(async (tx) => {
    await recordAudit(tx, ctx, {
      action: "privacy_request.export_downloaded",
      entity: { type: "privacy_request", id: row.id },
      before: null,
      after: privacyRequestAuditSnapshot(row),
      actorRole: null,
    });
  });
  return {
    ok: true,
    url,
    expiresAt: new Date(ctx.clock.now().getTime() + EXPORT_URL_SECONDS * 1000),
  };
}
