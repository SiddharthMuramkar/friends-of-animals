import { and, eq, gt, inArray, or } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { entryUploadGrant, fileAsset } from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import type { ObjectStorage } from "../../ports/storage";
import {
  ENTRY_FILE_PURPOSES,
  type EntryFilePurpose,
} from "../files/domain/purposes";
import {
  quarantineKeyFor,
  storageKeyFor,
  uploadKeyFor,
} from "../files/domain/storage-key";

const MAX_OUTSTANDING_GRANTS = 3;
const MAX_GRANTS_PER_UPLOAD_WINDOW = 6;
const STAGED_UPLOAD_SWEEP_DELAY_MS = 60 * 60 * 1000;

/** Register both cleanups in the same transaction as the grant. */
export async function scheduleUploadGrantCleanup(
  tx: AppDb,
  clock: Clock,
  { fileId, expiresAt }: { fileId: string; expiresAt: Date }
): Promise<void> {
  const aggregate = { type: "file_asset", id: fileId } as const;
  await emit(
    tx,
    clock,
    { type: "entry.upload_grant_issued", aggregate, payload: { fileId } },
    { availableAt: expiresAt }
  );
  // A provider may still be finishing a PUT when the first cleanup runs.
  // The file ID still locates the staging object after the grant is gone.
  await emit(
    tx,
    clock,
    { type: "entry.sweep_staged_upload", aggregate, payload: { fileId } },
    {
      availableAt: new Date(expiresAt.getTime() + STAGED_UPLOAD_SWEEP_DELAY_MS),
    }
  );
}

/** Called with both the uploader and the registration locked. */
export async function canIssueUploadGrant(
  tx: AppDb,
  {
    ownerId,
    registrationId,
    now,
    retiringFileId,
  }: {
    ownerId: string;
    registrationId: string;
    now: Date;
    retiringFileId: string | undefined;
  }
): Promise<boolean> {
  const grants = await tx
    .select({
      fileId: entryUploadGrant.fileAssetId,
      ownerId: fileAsset.ownerUserId,
      status: fileAsset.status,
      registrationId: entryUploadGrant.registrationId,
      retired: entryUploadGrant.retired,
    })
    .from(entryUploadGrant)
    .innerJoin(fileAsset, eq(fileAsset.id, entryUploadGrant.fileAssetId))
    .where(
      and(
        gt(entryUploadGrant.expiresAt, now),
        or(
          eq(fileAsset.ownerUserId, ownerId),
          eq(entryUploadGrant.registrationId, registrationId)
        )
      )
    );
  const outstanding = grants.filter(
    (grant) =>
      grant.status === "pending_upload" &&
      !grant.retired &&
      grant.fileId !== retiringFileId
  );
  // Completed and retired PUT URLs both count until they expire.
  return (
    grants.filter((grant) => grant.ownerId === ownerId).length <
      MAX_GRANTS_PER_UPLOAD_WINDOW &&
    outstanding.filter((grant) => grant.ownerId === ownerId).length <
      MAX_OUTSTANDING_GRANTS &&
    !outstanding.some((grant) => grant.registrationId === registrationId)
  );
}

/** Finds the uploader's unfinished grant while holding the registration lock. */
export async function pendingUploadFileId(
  tx: AppDb,
  ownerId: string,
  registrationId: string,
  now: Date
): Promise<string | undefined> {
  const [pending] = await tx
    .select({ id: fileAsset.id })
    .from(entryUploadGrant)
    .innerJoin(fileAsset, eq(fileAsset.id, entryUploadGrant.fileAssetId))
    .where(
      and(
        eq(entryUploadGrant.registrationId, registrationId),
        eq(fileAsset.ownerUserId, ownerId),
        eq(fileAsset.status, "pending_upload"),
        eq(entryUploadGrant.retired, false),
        gt(entryUploadGrant.expiresAt, now)
      )
    );
  return pending?.id;
}

/**
 * An entry's upload (a picture, a video or an essay's PDF), locked: the
 * file lock serializes preparation, acceptance and expiry.
 */
export async function lockEntryUpload(
  tx: AppDb,
  fileId: string,
  ownerId?: string
) {
  const [file] = await tx
    .select()
    .from(fileAsset)
    .where(
      and(
        eq(fileAsset.id, fileId),
        inArray(fileAsset.purpose, [...ENTRY_FILE_PURPOSES]),
        ownerId === undefined ? undefined : eq(fileAsset.ownerUserId, ownerId)
      )
    )
    .for("update");
  if (!file) return null;
  // Read the grant after acquiring the file lock, to see preparation by a
  // request that held the lock first.
  const [grant] = await tx
    .select()
    .from(entryUploadGrant)
    .where(eq(entryUploadGrant.fileAssetId, fileId));
  return { file, grant };
}

export function validUploadGrant(
  grant: typeof entryUploadGrant.$inferSelect | undefined,
  registrationId: string,
  now: Date
) {
  return grant?.registrationId === registrationId &&
    !grant.retired &&
    grant.expiresAt > now
    ? grant
    : null;
}

export async function expireUploadGrant(
  {
    db,
    clock,
    storage,
    files: { bucket, keyPrefix: prefix },
  }: {
    db: AppDb;
    clock: Clock;
    storage: ObjectStorage;
    files: { bucket: string; keyPrefix: string | null };
  },
  { fileId }: { fileId: string }
): Promise<void> {
  await db.transaction(async (tx) => {
    const upload = await lockEntryUpload(tx, fileId);
    if (!upload?.grant || upload.grant.expiresAt > clock.now()) return;
    const { file, grant } = upload;
    if (prefix === null) {
      throw new Error("The database has no entry staging prefix");
    }
    const keyFields = { prefix, fileId: file.id };
    const stagedKey = uploadKeyFor(keyFields);
    const originalKey = storageKeyFor({
      ...keyFields,
      purpose: file.purpose as EntryFilePurpose,
    });
    // A scan can already have moved an accepted file by the time its grant expires.
    const quarantinedInScope =
      file.uploadedAt !== null &&
      file.status === "quarantined" &&
      file.storageKey === quarantineKeyFor(keyFields);
    if (
      file.bucket !== bucket ||
      grant.uploadKey !== stagedKey ||
      (file.storageKey !== originalKey && !quarantinedInScope)
    ) {
      throw new Error(
        "Entry upload does not match the worker storage namespace"
      );
    }
    await storage.delete({ bucket, key: stagedKey });
    if (file.uploadedAt) {
      await tx
        .delete(entryUploadGrant)
        .where(eq(entryUploadGrant.fileAssetId, fileId));
    } else {
      // Preparation may have moved the object before acceptance was refused.
      await storage.delete({ bucket, key: originalKey });
      await tx.delete(fileAsset).where(eq(fileAsset.id, fileId));
    }
  });
}
