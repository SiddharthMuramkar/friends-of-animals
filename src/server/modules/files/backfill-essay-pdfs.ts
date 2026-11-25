// #86 made an uploaded essay live as soon as its scan passed. #96 requires
// a separate raster-only copy for judges. Queue the same media work for
// previously clean PDFs, without reopening their entry or resending a
// submission receipt. Existing processing rows make this safe to rerun.
// Loads in plain Node (the default worker): relative imports only.

import { and, eq, inArray, notExists } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { entryFile, fileAsset, fileProcessing } from "../../db/schema";
import type { ScheduleDefinition } from "../../outbox/schedules";
import type { Clock } from "../../ports/clock";
import { queueMediaWork } from "./process-image";

const BATCH_SIZE = 100;

export async function queueMissingEssayPdfWork({
  db,
  clock,
}: {
  db: AppDb;
  clock: Clock;
}): Promise<number> {
  return db.transaction(async (tx) => {
    const files = await tx
      .select({
        id: fileAsset.id,
        purpose: fileAsset.purpose,
        contentType: fileAsset.contentType,
      })
      .from(fileAsset)
      .innerJoin(entryFile, eq(entryFile.fileAssetId, fileAsset.id))
      .where(
        and(
          eq(fileAsset.purpose, "entry_document"),
          eq(fileAsset.contentType, "application/pdf"),
          eq(fileAsset.status, "clean"),
          eq(entryFile.kind, "document"),
          inArray(entryFile.status, ["live", "pending", "processing"]),
          notExists(
            tx
              .select({ id: fileProcessing.fileAssetId })
              .from(fileProcessing)
              .where(eq(fileProcessing.fileAssetId, fileAsset.id))
          )
        )
      )
      .orderBy(fileAsset.id)
      .limit(BATCH_SIZE)
      .for("share", { of: fileAsset, skipLocked: true });
    let queued = 0;
    for (const file of files) {
      if (await queueMediaWork(tx, clock, file)) queued += 1;
    }
    return queued;
  });
}

export const essayPdfBackfillSchedule: ScheduleDefinition = {
  name: "files.backfill_essay_pdfs",
  cron: "*/10 * * * *",
  tz: "UTC",
  async run(deps) {
    await queueMissingEssayPdfWork(deps);
  },
};
