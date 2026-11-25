// #94 owns the single physical readiness check. Until that authoritative
// seam is available, fail closed: verified digital work alone never makes a
// physical artwork ready. #94 replaces this adapter with its set-based check.
import type { AppDb } from "../../db/app-db";
export async function physicallyReadyEntryIds(
  _db: AppDb,
  _competitionId: string
): Promise<Set<string>> {
  return new Set();
}
