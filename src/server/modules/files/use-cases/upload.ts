// Uploading a file (#63).
//
//   requestUpload({ purpose, contentType, sizeBytes })  → any signed-in user
//   completeUpload({ fileId })                          → the uploader
//
// The browser PUTs the bytes straight to object storage through a presigned
// URL, which signs in the declared type and length; then it calls
// completeUpload, which checks the stored object against the declaration
// before the file goes on to its malware scan (files.file_uploaded).
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import { fileAsset, type FileAssetRow } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import type { UseCaseContext } from "../../../use-cases";
import {
  nextFileStatus,
  type FileEvent,
  type FileStatus,
} from "../domain/file-status";
import {
  checkStoredObject,
  checkUploadRequest,
  FILE_PURPOSES,
  normaliseContentType,
  type FilePurpose,
  type UploadRefusal,
} from "../domain/purposes";
import { storageKeyFor } from "../domain/storage-key";

/** What the Files use cases use. */
export type FilesContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "storage" | "files"
>;

/** How long the browser has to PUT the file. */
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;

export type RequestUploadInput = {
  purpose: FilePurpose;
  contentType: string;
  sizeBytes: number;
};

export type RequestUploadResult =
  | {
      ok: true;
      fileId: string;
      /** PUT the bytes here, with `headers`, before `expiresAt`. */
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: Date;
    }
  | InvalidInput
  | { ok: false; error: UploadRefusal };

const requestUploadInput = z.object({
  purpose: z.enum(FILE_PURPOSES),
  contentType: z.string().max(255),
  sizeBytes: z.int().nonnegative(),
});

/**
 * Records a pending file and presigns its upload. Nothing is written when
 * the purpose's rules refuse the declaration.
 */
export async function requestUpload(
  ctx: FilesContext,
  input: RequestUploadInput
): Promise<RequestUploadResult> {
  await authorize(ctx, "file.upload");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const parsed = requestUploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { purpose, sizeBytes } = parsed.data;
  const contentType = normaliseContentType(parsed.data.contentType);
  const check = checkUploadRequest(
    { purpose, contentType, sizeBytes },
    ctx.files.appEnv
  );
  if (!check.ok) return { ok: false, error: check.refusal };

  const now = ctx.clock.now();
  const fileId = uuidv7(now);
  const { bucket, keyPrefix } = ctx.files;
  const storageKey = storageKeyFor({ prefix: keyPrefix, purpose, fileId });
  const { url, headers } = await ctx.storage.presignPut({
    bucket,
    key: storageKey,
    contentType,
    contentLength: sizeBytes,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });
  await ctx.db.insert(fileAsset).values({
    id: fileId,
    ownerUserId: ctx.actor.userId,
    purpose,
    contentType,
    sizeBytes,
    bucket,
    storageKey,
    status: "pending_upload",
    createdAt: now,
    updatedAt: now,
  });
  return {
    ok: true,
    fileId,
    uploadUrl: url,
    headers,
    expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
  };
}

export type CompleteUploadInput = { fileId: string };

export type CompleteUploadResult =
  /** Uploaded, or further along if it was completed before. */
  | { ok: true; fileId: string; status: FileStatus }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        /** Nothing stored yet: the file stays pending; PUT, then retry. */
        | "upload_missing"
        /** The stored object didn't match its declaration; it was deleted. */
        | "upload_rejected";
    };

const completeUploadInput = z.object({ fileId: z.uuid() });

/**
 * Confirms that the stored object is what was declared. A match marks the
 * file uploaded and emits files.file_uploaded, in one transaction; a
 * mismatch deletes the object and rejects the file. Safe to call again:
 * a file that is no longer pending is reported as it stands.
 */
export async function completeUpload(
  ctx: FilesContext,
  input: CompleteUploadInput
): Promise<CompleteUploadResult> {
  await authorize(ctx, "file.upload");
  const parsed = completeUploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fileId } = parsed.data;
  const file = await findFile(ctx.db, fileId);
  if (!file) return { ok: false, error: "not_found" };
  await authorize(ctx, "file.complete", { ownerId: file.ownerUserId });
  if (file.status !== "pending_upload") return asItStands(file);

  const ref = { bucket: file.bucket, key: file.storageKey };
  const check = checkStoredObject(file, await ctx.storage.head(ref));
  if (!check.ok && check.refusal === "upload_missing") {
    return { ok: false, error: "upload_missing" };
  }
  const now = ctx.clock.now();
  if (!check.ok) {
    // Delete first: if the update then fails, the file is still pending
    // and a retry finds no object, rather than an object left behind.
    await ctx.storage.delete(ref);
    const rejected = await leavePending(ctx.db, file, "upload_rejected", now);
    return rejected
      ? { ok: false, error: "upload_rejected" }
      : asItStands((await findFile(ctx.db, fileId))!);
  }

  return ctx.db.transaction(async (tx) => {
    const status = await leavePending(tx, file, "upload_confirmed", now);
    if (!status) return asItStands((await findFile(tx, fileId))!);
    await emit(tx, ctx.clock, {
      type: "files.file_uploaded",
      aggregate: { type: "file_asset", id: fileId },
      payload: { fileId },
    });
    return { ok: true, fileId, status } as const;
  });
}

async function findFile(
  db: AppDb,
  fileId: string
): Promise<FileAssetRow | undefined> {
  const [row] = await db
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  return row;
}

/**
 * Moves a pending file on by `event`, only if it is still pending, and
 * returns its new status; null if another call moved it first.
 */
async function leavePending(
  db: AppDb,
  file: FileAssetRow,
  event: Extract<FileEvent, "upload_confirmed" | "upload_rejected">,
  now: Date
): Promise<FileStatus | null> {
  const status = nextFileStatus("pending_upload", event);
  if (!status) throw new Error(`A pending file can't take ${event}`);
  const [moved] = await db
    .update(fileAsset)
    .set({
      status,
      updatedAt: now,
      ...(status === "uploaded" ? { uploadedAt: now } : {}),
    })
    .where(
      and(eq(fileAsset.id, file.id), eq(fileAsset.status, "pending_upload"))
    )
    .returning({ id: fileAsset.id });
  return moved ? status : null;
}

/** What completing a file that is no longer pending reports. */
function asItStands(file: FileAssetRow): CompleteUploadResult {
  return file.status === "rejected"
    ? { ok: false, error: "upload_rejected" }
    : { ok: true, fileId: file.id, status: file.status };
}
