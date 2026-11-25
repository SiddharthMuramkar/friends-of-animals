// The round admission transaction uses the authoritative custody check;
// no digital status or judge action can substitute for a verified original.
import type { AppDb } from "../../db/app-db";
import { physicallyReadyEntryIds as readyArtworkEntryIds } from "../physical-artwork/readiness";

export function physicallyReadyEntryIds(
  db: AppDb,
  competitionId: string
): Promise<Set<string>> {
  return readyArtworkEntryIds(db, { competitionId });
}
