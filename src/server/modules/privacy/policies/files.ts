// Quarantined files (#63, #114): an upload the scanner flagged is deleted,
// row and stored objects, once its period has passed. A payment's proof
// is never purged here: offline_payment.proof_file_asset_id stays NOT NULL
// (Decision 2), so a quarantined proof is kept with its payment record
// under the financial policy, and this policy skips any file a payment
// still names.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { fileAsset, legalHold, offlinePayment } from "../../../db/schema";
import { retireQuarantinedPostImage } from "../../cms/posts/images";
import { purgeQuarantinedFile, stageQuarantinePurge } from "../../files/purge";
import { instant, rowPolicy } from "./define";
import type { RetentionPolicy } from "./types";

export const QUARANTINED_FILES: RetentionPolicy = {
  ...rowPolicy({
    key: "quarantinedFiles",
    table: fileAsset,
    action: "delete",
    period: "quarantinedFiles",
    // The scan records the quarantine time. Moving the object can update
    // the row later, so only fall back to updatedAt for rows without it.
    anchor: instant(
      sql`coalesce(${fileAsset.scannedAt}, ${fileAsset.updatedAt})`,
      fileAsset.updatedAt
    ),
    where: and(
      eq(fileAsset.status, "quarantined"),
      sql`NOT EXISTS (
        SELECT 1 FROM ${offlinePayment}
        WHERE ${offlinePayment.proofFileAssetId} = ${fileAsset.id}
      )`
    ),
    subjects: [["user", fileAsset.ownerUserId]],
  }),
  apply: stageQuarantinePurge,
  async finishDeletion(db, id, storage) {
    const [file] = await db
      .select()
      .from(fileAsset)
      .where(
        and(eq(fileAsset.id, id), eq(fileAsset.quarantinePurgePending, true))
      )
      .for("update");
    if (!file) return "skipped";

    const [proof] = await db
      .select({ id: offlinePayment.id })
      .from(offlinePayment)
      .where(eq(offlinePayment.proofFileAssetId, id))
      .limit(1);
    if (proof) return "skipped";

    const subjects = [{ type: "user", id: file.ownerUserId }];
    const holds = await db
      .select({ type: legalHold.subjectType, id: legalHold.subjectId })
      .from(legalHold)
      .where(
        and(
          inArray(
            legalHold.subjectId,
            subjects.map(({ id }) => id)
          ),
          isNull(legalHold.releasedAt)
        )
      );
    if (
      holds.some((hold) =>
        subjects.some(({ type, id }) => type === hold.type && id === hold.id)
      )
    )
      return "held";
    if (
      file.purpose === "cms_image" &&
      !(await retireQuarantinedPostImage(db, id))
    )
      return "skipped";
    await purgeQuarantinedFile(db, file, storage);
    return "deleted";
  },
};
