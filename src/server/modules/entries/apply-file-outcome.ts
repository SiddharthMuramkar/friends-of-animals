// The worker's handler for an entry's upload (#85): entries.apply_file_outcome,
// on each step the Files module takes with a file (scan clean, quarantined,
// rejected; derivatives made, or not). It brings the entry file up to date
// with where the upload stands (./store.ts settleEntryFile), so the order
// the events arrive in, a late one or a repeat, changes nothing. A file
// that isn't an entry's (a post's image, a payment proof) is left alone.
//
// Loads under plain Node (the worker): relative imports only.

import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import { promoteShortlistedEntry } from "../school-round/promote-shortlisted-entry";
import { entryFileOf, lockEntry, settleEntryFile } from "./store";

export async function applyEntryFileOutcome(
  deps: { db: AppDb; clock: Clock },
  { fileId }: { fileId: string }
): Promise<void> {
  const found = await entryFileOf(deps.db, fileId);
  if (!found) return;
  await deps.db.transaction(async (tx) => {
    const locked = await lockEntry(tx, found.entryId);
    if (locked) await settleEntryFile(tx, deps.clock, locked, found.id);
  });
  await promoteShortlistedEntry(deps, found.entryId);
}
