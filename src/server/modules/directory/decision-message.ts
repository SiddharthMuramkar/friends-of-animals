// What FOA's messages about a listing decision may say (#127): the
// listing's name and the reason staff gave, read when the message goes.
// Used by the notifications dispatcher (src/server/modules/notifications/
// audiences.ts) for the directory.listing_* routes.
//
// Loads under plain Node (the worker): relative imports only.

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { directoryListing } from "../../db/schema";

export const LISTING_DECISION_VARIABLES = [
  "listing.name",
  "listing.reason",
] as const;

export async function listingDecisionValues(
  db: AppDb,
  listingId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      name: directoryListing.name,
      reason: directoryListing.statusReason,
    })
    .from(directoryListing)
    .where(eq(directoryListing.id, listingId));
  if (!row) return {};
  return {
    "listing.name": row.name,
    ...(row.reason === null ? {} : { "listing.reason": row.reason }),
  };
}
