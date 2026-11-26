import type { survey } from "../../db/schema";
import type { AppDb } from "../../db/app-db";
import { publishedRelease } from "../results/read-published";

export async function publicationExists(
  db: AppDb,
  competitionId: string,
  now: Date
) {
  const release = await publishedRelease(db, competitionId);
  return release !== null && release.publishedAt <= now;
}
export function isOpen(row: typeof survey.$inferSelect, now: Date) {
  return (
    !!row.sentAt &&
    row.sentAt <= now &&
    !!row.closesAt &&
    !row.closedAt &&
    row.closesAt > now
  );
}
