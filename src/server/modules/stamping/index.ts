// Trusted module seam, NOT generic upload/read use cases. Callers must
// authorize their subject and current purpose-specific consent before
// queueing or delivering. A stamp never changes an original or its safe
// display derivative, and lives only in the original's private bucket.
import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  certificate,
  entryFile,
  fileAsset,
  fileDerivative,
  outbox,
} from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import type { OutboxDeps } from "../../outbox/handlers";
import type { ObjectStorage } from "../../ports/storage";
import { uuidv7 } from "../../ids";
import { readAll } from "../files/process-image";
import { storagePrefixOf } from "../files/domain/storage-key";
import { derivativeKeyFor } from "../files/domain/media-work";
import { STAMP_SETTINGS, type StampVariant } from "./domain/variants";

export type StampInput = { fileId: string; variant: StampVariant };
type Source = { bucket: string; key: string };
async function sourceOf(db: AppDb, input: StampInput): Promise<Source | null> {
  const [file] = await db
    .select()
    .from(fileAsset)
    .where(and(eq(fileAsset.id, input.fileId), eq(fileAsset.status, "clean")));
  if (!file) return null;
  if (input.variant === "certificate_share") {
    // A generated PDF is already a private certificate copy, never an upload.
    if (
      file.purpose !== "certificate_pdf" ||
      file.scanResult !== "generated" ||
      file.contentType !== "application/pdf"
    )
      return null;
    const [issued] = await db
      .select({ id: certificate.id })
      .from(certificate)
      .where(
        and(
          eq(certificate.pdfFileId, file.id),
          eq(certificate.status, "issued"),
          eq(certificate.renderStatus, "rendered")
        )
      );
    return issued ? { bucket: file.bucket, key: file.storageKey } : null;
  }
  if (file.purpose !== "entry_image") return null;
  const [copy] = await db
    .select()
    .from(fileDerivative)
    .where(
      and(
        eq(fileDerivative.fileAssetId, file.id),
        eq(fileDerivative.kind, "display_1600"),
        eq(fileDerivative.contentType, "image/webp"),
        eq(fileDerivative.bucket, file.bucket)
      )
    );
  return copy &&
    copy.width &&
    copy.height &&
    copy.storageKey ===
      derivativeKeyFor({
        prefix: storagePrefixOf(file),
        fileId: file.id,
        kind: "display_1600",
      })
    ? { bucket: copy.bucket, key: copy.storageKey }
    : null;
}

/** Current image only; callers supply the entry id from their authorized resource. */
export async function liveEntryStampSource(db: AppDb, entryId: string) {
  const [live] = await db
    .select({ fileId: entryFile.fileAssetId })
    .from(entryFile)
    .where(
      and(
        eq(entryFile.entryId, entryId),
        eq(entryFile.kind, "image"),
        eq(entryFile.status, "live")
      )
    );
  return live?.fileId ?? null;
}

/** Trusted availability check for curation. No key or signed URL escapes. */
export async function stampSourceAvailable(db: AppDb, input: StampInput) {
  return (await sourceOf(db, input)) !== null;
}
export async function stampedImage(ctx: { db: AppDb }, input: StampInput) {
  if (!(await sourceOf(ctx.db, input))) return null;
  const settings = STAMP_SETTINGS[input.variant];
  const [copy] = await ctx.db
    .select()
    .from(fileDerivative)
    .innerJoin(fileAsset, eq(fileAsset.id, fileDerivative.fileAssetId))
    .where(
      and(
        eq(fileDerivative.fileAssetId, input.fileId),
        eq(fileDerivative.kind, settings.kind),
        eq(fileAsset.status, "clean"),
        eq(fileDerivative.bucket, fileAsset.bucket),
        eq(fileDerivative.contentType, settings.contentType)
      )
    );
  const d = copy?.file_derivative;
  if (
    !d?.width ||
    !d.height ||
    d.storageKey !==
      derivativeKeyFor({
        prefix: storagePrefixOf(copy!.file_asset),
        fileId: input.fileId,
        kind: settings.kind,
      })
  )
    return null;
  return {
    bucket: d.bucket,
    key: d.storageKey,
    contentType: d.contentType,
    width: d.width,
    height: d.height,
    sizeBytes: d.sizeBytes,
    sampleIllustration:
      copy!.file_asset.scanResult === "generated_sample_illustration",
  };
}

/** Queue once per source/version while pending. Must be called in a transaction.
 * Retrying after a terminal failed delivery is permitted; ready is a no-op. */
export async function queueStamp(
  tx: AppDb,
  clock: Clock,
  input: StampInput
): Promise<"ready" | "queued" | "unavailable"> {
  const [file] = await tx
    .select({ id: fileAsset.id })
    .from(fileAsset)
    .where(eq(fileAsset.id, input.fileId))
    .for("update");
  if (!file || !(await sourceOf(tx, input))) return "unavailable";
  if (await stampedImage({ db: tx }, input)) return "ready";
  const [pending] = await tx
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        eq(outbox.aggregateId, input.fileId),
        eq(outbox.handler, "stamping.render"),
        eq(outbox.status, "pending"),
        sql`${outbox.payload}->>'variant' = ${input.variant}`
      )
    )
    .limit(1);
  if (!pending)
    await emit(tx, clock, {
      type: "stamping.requested",
      aggregate: { type: "file_asset", id: input.fileId },
      payload: input,
    });
  return "queued";
}

/** At-least-once job: serialize per source and store the same immutable
 * versioned key. A purge cannot race the source lock to create a new row. */
export async function renderStamp(
  ctx: Pick<OutboxDeps, "db" | "clock" | "media"> & {
    storage: Pick<ObjectStorage, "read" | "write">;
  },
  input: StampInput
) {
  await ctx.db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.id, input.fileId))
      .for("update");
    if (!file || (await stampedImage({ db: tx }, input))) return;
    const source = await sourceOf(tx, input);
    if (!source) return;
    const bytes = await readAll(await ctx.storage.read(source));
    const rendered = await ctx.media.stampImage({
      bytes,
      variant: input.variant,
    });
    const settings = STAMP_SETTINGS[input.variant];
    if (
      rendered.contentType !== settings.contentType ||
      !rendered.width ||
      !rendered.height ||
      !rendered.bytes.length
    )
      throw new Error("Invalid stamped derivative");
    const key = derivativeKeyFor({
      prefix: storagePrefixOf(file),
      fileId: file.id,
      kind: settings.kind,
    });
    await ctx.storage.write({
      bucket: file.bucket,
      key,
      body: rendered.bytes,
      contentType: settings.contentType,
    });
    const now = ctx.clock.now();
    await tx.insert(fileDerivative).values({
      id: uuidv7(now),
      fileAssetId: file.id,
      kind: settings.kind,
      bucket: file.bucket,
      storageKey: key,
      contentType: settings.contentType,
      width: rendered.width,
      height: rendered.height,
      durationMs: null,
      sizeBytes: rendered.bytes.length,
      createdAt: now,
    });
  });
}

/** Only for an already-authorized private download, not a public projection. */
export async function stampedImageUrl(
  ctx: { db: AppDb; clock: Clock; storage: ObjectStorage },
  input: StampInput & { filename: string }
) {
  const copy = await stampedImage(ctx, input);
  if (!copy) return null;
  const { url } = await ctx.storage.presignGet({
    bucket: copy.bucket,
    key: copy.key,
    contentType: copy.contentType,
    expiresInSeconds: 300,
    filename: input.filename,
    disposition: "attachment",
  });
  return { url, expiresAt: new Date(ctx.clock.now().getTime() + 300_000) };
}
