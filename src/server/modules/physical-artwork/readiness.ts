// The sole physical admission predicate used by judging and auctions.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { physicalArtwork } from "../../db/schema";
import { READY_FOR_JUDGING_STATUSES } from "./domain/custody";

export async function isPhysicallyReadyForJudging(
  db: AppDb,
  entryId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: physicalArtwork.id })
    .from(physicalArtwork)
    .where(
      and(
        eq(physicalArtwork.entryId, entryId),
        inArray(physicalArtwork.status, READY_FOR_JUDGING_STATUSES)
      )
    );
  return row !== undefined;
}

/** Use inside a round-admission transaction: conflicting custody changes
 * wait on the same artwork locks. A missing or unready row is never admitted. */
export async function physicallyReadyEntryIds(
  db: AppDb,
  input: { competitionId: string }
): Promise<Set<string>> {
  const rows = await db
    .select({ entryId: physicalArtwork.entryId })
    .from(physicalArtwork)
    .where(
      and(
        eq(physicalArtwork.competitionId, input.competitionId),
        inArray(physicalArtwork.status, READY_FOR_JUDGING_STATUSES)
      )
    )
    .orderBy(asc(physicalArtwork.entryId))
    .for("update");
  return new Set(rows.map((r) => r.entryId));
}
