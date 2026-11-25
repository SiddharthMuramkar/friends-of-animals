// Issuing an entry file's upload grant (#85): the tail every entry upload
// shares, the participant's (startEntryUpload) and the coordinator's for a
// shortlisted entry (#91, the school round module). With the uploader and
// the registration locked: retire the grant the uploader is replacing,
// check the uploader's grant limits, presign a private upload under the
// purpose for the kind of file, record the grant and schedule its cleanup.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { entryUploadGrant, user } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import type { EntryFilePurpose } from "../files/domain/purposes";
import { uploadKeyFor } from "../files/domain/storage-key";
import { presignUpload } from "../files/use-cases/upload";
import {
  canIssueUploadGrant,
  lockEntryUpload,
  pendingUploadFileId,
  scheduleUploadGrantCleanup,
  validUploadGrant,
} from "./upload-grants";

export type IssuedUploadGrant =
  | {
      ok: true;
      fileId: string;
      /** PUT the file here, with `headers`, before `expiresAt`. */
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: Date;
    }
  | { ok: false; error: "upload_limit" };

/** Serializes one uploader's grant requests, even across registrations. */
export async function lockUploader(tx: AppDb, ownerId: string): Promise<void> {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, ownerId))
    .for("no key update");
}

/** Called with the uploader (lockUploader) and the registration locked. */
export async function issueEntryUploadGrant(
  ctx: UseCaseContext,
  tx: AppDb,
  request: {
    ownerId: string;
    registrationId: string;
    uploader: "participant" | "coordinator";
    purpose: EntryFilePurpose;
    contentType: string;
    sizeBytes: number;
    replacesFileId?: string | undefined;
    restartPendingUpload?: boolean | undefined;
  }
): Promise<IssuedUploadGrant> {
  const { ownerId, registrationId, purpose } = request;
  const now = ctx.clock.now();
  const previousFileId =
    request.replacesFileId ??
    (request.restartPendingUpload
      ? await pendingUploadFileId(tx, ownerId, registrationId, now)
      : undefined);
  const previous = previousFileId
    ? await lockEntryUpload(tx, previousFileId, ownerId)
    : null;
  const retiringFileId =
    previous?.file.status === "pending_upload" &&
    validUploadGrant(previous.grant, registrationId, now)
      ? previous.file.id
      : undefined;
  if (
    !(await canIssueUploadGrant(tx, {
      ownerId,
      registrationId,
      now,
      retiringFileId,
      uploader: request.uploader,
    }))
  ) {
    return { ok: false, error: "upload_limit" };
  }
  if (retiringFileId) {
    await tx
      .update(entryUploadGrant)
      .set({ retired: true })
      .where(eq(entryUploadGrant.fileAssetId, retiringFileId));
  }

  const presigned = await presignUpload(ctx, tx, {
    purpose,
    contentType: request.contentType,
    sizeBytes: request.sizeBytes,
  });
  if (!presigned.ok) {
    // The entry's rule is narrower than the purpose's, so this is a bug.
    throw new Error(
      `The ${purpose} purpose refused an upload: ${presigned.error}`
    );
  }
  const { fileId, expiresAt } = presigned;
  await tx.insert(entryUploadGrant).values({
    fileAssetId: fileId,
    registrationId,
    uploadKey: uploadKeyFor({ prefix: ctx.files.keyPrefix, fileId }),
    expiresAt,
  });
  await scheduleUploadGrantCleanup(tx, ctx.clock, { fileId, expiresAt });
  return presigned;
}
