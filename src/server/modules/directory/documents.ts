// Proof a listing sends for FOA's verification (#127): a registration
// certificate, an identity proof. Only staff open them; the listing's own
// people see what they sent and how far its scan got, never the file.
//
//   requestListingDocumentUpload({ listingId, kind, contentType, sizeBytes })
//       → the listing's people: a presigned upload of purpose
//         directory_document; the browser PUTs it and calls completeUpload
//   getListingDocumentUrl({ documentId })
//       → staff admins and super admins: a signed URL, through Files' one
//         delivery gate (scan status, audit of every staff read)

import { count, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { directoryListingDocument } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  getFileDownloadUrl,
  type GetFileDownloadUrlResult,
} from "../files/use-cases/delivery";
import {
  presignUpload,
  type RequestUploadResult,
} from "../files/use-cases/upload";
import { listingActedFor } from "./acting-for";
import { DOCUMENT_KINDS } from "./domain/documents";
import { takesDocuments } from "./queries";

/** Enough for every kind on the checklist, and a few replacements. */
export const DOCUMENTS_PER_LISTING_MAX = 10;

export type RequestListingDocumentUploadInput = {
  listingId: string;
  kind: string;
  contentType: string;
  sizeBytes: number;
};

export type RequestListingDocumentUploadResult =
  | (Extract<RequestUploadResult, { ok: true }> & { documentId: string })
  | Exclude<RequestUploadResult, { ok: true }>
  | InvalidInput
  | { ok: false; error: "listing_not_editable" | "too_many_documents" };

const uploadInput = z.object({
  listingId: z.uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  contentType: z.string().max(200),
  sizeBytes: z.number(),
});

export async function requestListingDocumentUpload(
  ctx: UseCaseContext,
  input: RequestListingDocumentUploadInput
): Promise<RequestListingDocumentUploadResult> {
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { listingId, kind, contentType, sizeBytes } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const { row, role } = await listingActedFor(ctx, tx, listingId, {
      lock: true,
    });
    if (!takesDocuments(row.status)) {
      return { ok: false, error: "listing_not_editable" } as const;
    }
    const [counted] = await tx
      .select({ documents: count() })
      .from(directoryListingDocument)
      .where(eq(directoryListingDocument.listingId, listingId));
    if ((counted?.documents ?? 0) >= DOCUMENTS_PER_LISTING_MAX) {
      return { ok: false, error: "too_many_documents" } as const;
    }
    const upload = await presignUpload(ctx, tx, {
      purpose: "directory_document",
      contentType,
      sizeBytes,
    });
    if (!upload.ok) return upload;

    const now = ctx.clock.now();
    const documentId = uuidv7(now);
    await tx.insert(directoryListingDocument).values({
      id: documentId,
      listingId,
      fileAssetId: upload.fileId,
      kind,
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "directory.document_added",
      entity: { type: "directory_listing", id: listingId },
      before: null,
      after: { documentId, kind, fileId: upload.fileId },
      actorRole: role,
    });
    return { ...upload, documentId };
  });
}

export type GetListingDocumentUrlResult =
  | GetFileDownloadUrlResult
  | { ok: false; error: "not_found" };

const documentInput = z.object({ documentId: z.uuid() });

export async function getListingDocumentUrl(
  ctx: UseCaseContext,
  input: { documentId: string }
): Promise<GetListingDocumentUrlResult> {
  await authorize(ctx, "directory.document.read");
  const parsed = documentInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [document] = await ctx.db
    .select({ fileId: directoryListingDocument.fileAssetId })
    .from(directoryListingDocument)
    .where(eq(directoryListingDocument.id, parsed.data.documentId));
  if (!document) return { ok: false, error: "not_found" };
  return getFileDownloadUrl(ctx, { fileId: document.fileId });
}
