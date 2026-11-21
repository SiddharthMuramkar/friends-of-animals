// The media job (#85): derived copies of each clean image.
//
//   scan passes  → queueMediaWork, in the scan's transaction: a
//                  file_processing row (queued) and a
//                  files.processing_requested event, only if the file's
//                  purpose and type get derivatives (./domain/media-work.ts)
//   worker-media → processImageAsset, the files.process_image handler on
//                  the media queue (src/server/outbox/queues.ts): reads the
//                  original, makes the derivatives with the MediaProcessor,
//                  stores them, then records the file_derivative rows and
//                  marks the job done, emitting files.file_processed
//
// A MediaError (a type it can't decode, corrupt pixels, too many pixels) is
// final: the job is marked failed with its code and emits
// files.file_processing_failed. Anything else (storage, the worker itself)
// throws, so the relay retries with backoff; on the last try the job is
// marked failed with processing_error before it throws.
//
// Delivery is at least once, so it is safe to repeat: only a clean file with
// a queued job is processed, and the job is finished only if it is still
// queued. A second run rewrites the same objects and changes no row.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, sql } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  fileAsset,
  fileDerivative,
  fileProcessing,
  type FileAssetRow,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import { DEFAULT_RETRY_POLICY } from "../../outbox/retry-policy";
import type { Clock } from "../../ports/clock";
import {
  MediaError,
  type FileProcessingErrorCode,
  type MediaProcessor,
  type MediaResult,
} from "../../ports/media";
import type { ObjectStorage } from "../../ports/storage";
import {
  derivativeKeyFor,
  derivativeKindsFor,
  storagePrefixOf,
} from "./domain/media-work";

export type MediaJobDeps = {
  db: AppDb;
  clock: Clock;
  storage: ObjectStorage;
  media: MediaProcessor;
};

/**
 * Queues the file's media job if it gets derivatives. Call it in the
 * transaction that marks the file clean, and nowhere else: nothing is
 * processed before its scan passes. Returns whether it queued one.
 */
export async function queueMediaWork(
  tx: AppDb,
  clock: Clock,
  file: Pick<FileAssetRow, "id" | "purpose" | "contentType">
): Promise<boolean> {
  if (derivativeKindsFor(file).length === 0) return false;
  const now = clock.now();
  const queued = await tx
    .insert(fileProcessing)
    .values({ fileAssetId: file.id, queuedAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: fileProcessing.fileAssetId });
  if (queued.length === 0) return false;
  await emit(tx, clock, {
    type: "files.processing_requested",
    aggregate: { type: "file_asset", id: file.id },
    payload: { fileId: file.id },
  });
  return true;
}

export async function processImageAsset(
  deps: MediaJobDeps,
  { attempt, payload }: { attempt: number; payload: { fileId: string } }
): Promise<void> {
  const file = await startJob(deps, payload.fileId);
  if (!file) return;
  let result: MediaResult;
  try {
    const bytes = await readAll(
      await deps.storage.read({ bucket: file.bucket, key: file.storageKey })
    );
    result = await deps.media.processImage({
      bytes,
      kinds: derivativeKindsFor(file),
    });
  } catch (error) {
    if (error instanceof MediaError) {
      await finishFailed(deps, file.id, error.code);
      return;
    }
    if (attempt >= DEFAULT_RETRY_POLICY.maxAttempts) {
      await finishFailed(deps, file.id, "processing_error");
    }
    throw error;
  }
  await storeDerivatives(deps, file, result);
}

/**
 * The file, if it is clean and its job is still queued, after counting
 * this attempt; otherwise null: nothing to do.
 */
async function startJob(
  { db, clock }: MediaJobDeps,
  fileId: string
): Promise<FileAssetRow | null> {
  const [file] = await db
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  if (!file || file.status !== "clean") return null;
  const started = await db
    .update(fileProcessing)
    .set({
      attempts: sql`${fileProcessing.attempts} + 1`,
      updatedAt: clock.now(),
    })
    .where(
      and(
        eq(fileProcessing.fileAssetId, fileId),
        eq(fileProcessing.status, "queued")
      )
    )
    .returning({ id: fileProcessing.fileAssetId });
  return started.length > 0 ? file : null;
}

async function readAll(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Writes the objects first, then records them and finishes the job in one
 * transaction, so a row never points at a missing object. If the job was
 * finished meanwhile, the objects written are the same ones, and no row
 * changes.
 */
async function storeDerivatives(
  { db, clock, storage }: MediaJobDeps,
  file: FileAssetRow,
  result: MediaResult
): Promise<void> {
  const prefix = storagePrefixOf(file);
  const now = clock.now();
  const rows: (typeof fileDerivative.$inferInsert)[] = [];
  for (const derivative of result.derivatives) {
    const key = derivativeKeyFor({
      prefix,
      fileId: file.id,
      kind: derivative.kind,
    });
    await storage.write({
      bucket: file.bucket,
      key,
      body: derivative.bytes,
      contentType: derivative.contentType,
    });
    rows.push({
      id: uuidv7(now),
      fileAssetId: file.id,
      kind: derivative.kind,
      bucket: file.bucket,
      storageKey: key,
      contentType: derivative.contentType,
      width: derivative.width,
      height: derivative.height,
      sizeBytes: derivative.bytes.length,
      createdAt: now,
    });
  }
  await db.transaction(async (tx) => {
    if (!(await finish(tx, now, file.id, { status: "done" }))) return;
    if (rows.length > 0) await tx.insert(fileDerivative).values(rows);
    await emit(tx, clock, {
      type: "files.file_processed",
      aggregate: { type: "file_asset", id: file.id },
      payload: { fileId: file.id },
    });
  });
}

async function finishFailed(
  { db, clock }: MediaJobDeps,
  fileId: string,
  code: FileProcessingErrorCode
): Promise<void> {
  const now = clock.now();
  await db.transaction(async (tx) => {
    if (!(await finish(tx, now, fileId, { status: "failed", code }))) return;
    await emit(tx, clock, {
      type: "files.file_processing_failed",
      aggregate: { type: "file_asset", id: fileId },
      payload: { fileId, code },
    });
  });
}

/** Ends the job if it is still queued; false if it had ended already. */
async function finish(
  tx: AppDb,
  now: Date,
  fileId: string,
  outcome:
    | { status: "done" }
    | { status: "failed"; code: FileProcessingErrorCode }
): Promise<boolean> {
  const finished = await tx
    .update(fileProcessing)
    .set({
      status: outcome.status,
      errorCode: outcome.status === "failed" ? outcome.code : null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(fileProcessing.fileAssetId, fileId),
        eq(fileProcessing.status, "queued")
      )
    )
    .returning({ id: fileProcessing.fileAssetId });
  return finished.length > 0;
}
