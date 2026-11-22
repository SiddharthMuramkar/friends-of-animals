// Uploading a file (#63).
//
//   requestUpload({ purpose, contentType, sizeBytes })  → any signed-in user
//   completeUpload({ fileId })                          → the uploader
//
// The browser PUTs the bytes straight to object storage through a presigned
// URL, which signs in the declared type and length; then it calls
// completeUpload, which takes the object and checks it against the
// declaration before the file goes on to its malware scan
// (files.file_uploaded).
//
// The URL names the upload key, `<prefix>incoming/<id>`, and it takes
// another PUT until it expires: presigned URLs aren't single-use. So
// completing moves the object to the file's storage key, which no URL
// names, and the scan and every download read only that. Bytes sent to the
// URL after that never reach what was scanned (domain/storage-key.ts).
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import { fileAsset, type FileAssetRow } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import { ObjectMissingError, type ObjectStorage } from "../../../ports/storage";
import type { UseCaseContext } from "../../../use-cases";
import { fileIdInput, requestUploadInput } from "../inputs";
import {
  nextFileStatus,
  type FileEvent,
  type FileStatus,
} from "../domain/file-status";
import {
  checkStoredObject,
  checkUploadRequest,
  normaliseContentType,
  type FilePurpose,
  type UploadRefusal,
} from "../domain/purposes";
import {
  storageKeyFor,
  storagePrefixOf,
  uploadKeyFor,
} from "../domain/storage-key";

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
    key: uploadKeyFor({ prefix: keyPrefix, fileId }),
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

/**
 * Takes the upload: moves the object from the upload key to the file's
 * storage key and checks it there against the declaration. A match marks
 * the file uploaded and emits files.file_uploaded; a mismatch deletes the
 * object and rejects the file. Safe to call again: a file that is no
 * longer pending is reported as it stands, and storage is left alone.
 */
export async function completeUpload(
  ctx: FilesContext,
  input: CompleteUploadInput
): Promise<CompleteUploadResult> {
  await authorize(ctx, "file.upload");
  const parsed = fileIdInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { fileId } = parsed.data;
  const found = await findFile(ctx.db, fileId);
  if (!found) return { ok: false, error: "not_found" };
  await authorize(ctx, "file.complete", { ownerId: found.ownerUserId });
  if (found.status !== "pending_upload") return asItStands(found);

  // The row stays locked while the object moves and the status changes, so
  // the storage key is written only while the file is pending, by one call
  // at a time: another call waits, then finds it no longer pending. The
  // scan can't start before this commits, since its event is emitted here.
  return ctx.db.transaction(async (tx): Promise<CompleteUploadResult> => {
    const file = await lockFile(tx, fileId);
    if (!file) return { ok: false, error: "not_found" };
    if (file.status !== "pending_upload") return asItStands(file);

    const stored = { bucket: file.bucket, key: file.storageKey };
    await takeUpload(ctx.storage, file);
    const check = checkStoredObject(file, await ctx.storage.head(stored));
    if (!check.ok && check.refusal === "upload_missing") {
      return { ok: false, error: "upload_missing" };
    }
    const now = ctx.clock.now();
    if (!check.ok) {
      // Delete first: if the update then fails, the file is still pending
      // and a retry finds no object, rather than an object left behind.
      await ctx.storage.delete(stored);
      const rejected = await leavePending(tx, file, "upload_rejected", now);
      return rejected
        ? { ok: false, error: "upload_rejected" }
        : asItStands((await findFile(tx, fileId))!);
    }

    const status = await leavePending(tx, file, "upload_confirmed", now);
    if (!status) return asItStands((await findFile(tx, fileId))!);
    await emit(tx, ctx.clock, {
      type: "files.file_uploaded",
      aggregate: { type: "file_asset", id: fileId },
      payload: { fileId },
    });
    return { ok: true, fileId, status };
  });
}

/**
 * Moves the browser's PUT, if one has arrived, from the upload key to the
 * file's storage key. Nothing at the upload key can also mean an earlier
 * call moved it and then failed before its status change, so the caller
 * checks the storage key either way.
 */
async function takeUpload(
  storage: ObjectStorage,
  file: FileAssetRow
): Promise<void> {
  const from = uploadKeyFor({
    prefix: storagePrefixOf(file),
    fileId: file.id,
  });
  try {
    await storage.move({ bucket: file.bucket, from, to: file.storageKey });
  } catch (error) {
    if (!(error instanceof ObjectMissingError)) throw error;
  }
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

/** The file's row, locked until the transaction ends. */
async function lockFile(
  tx: AppDb,
  fileId: string
): Promise<FileAssetRow | undefined> {
  const [row] = await tx
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId))
    .for("update");
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
