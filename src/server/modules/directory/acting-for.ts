// Finding a listing the actor acts for (#127), with the policy asked
// against that listing: its registrant until FOA first verifies it, then
// its organisation representatives (./domain/listing-edit.ts). A listing
// that doesn't exist is refused like one the actor may not touch, so ids
// can't be probed.

import { eq } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import { directoryListing, type DirectoryListingRow } from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { listingResource } from "./domain/listing-edit";

/**
 * The listing, read on `db` (locked when `lock` is set, inside the
 * caller's transaction), and the role that let the actor act for it.
 * Throws forbidden otherwise.
 */
export async function listingActedFor(
  ctx: UseCaseContext,
  db: AppDb,
  listingId: string,
  { lock = false }: { lock?: boolean } = {}
): Promise<{ row: DirectoryListingRow; role: Role | null }> {
  const query = db
    .select()
    .from(directoryListing)
    .where(eq(directoryListing.id, listingId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) {
    throw new DomainError(
      "forbidden",
      `${ctx.actor.kind} may not directory.manage`
    );
  }
  const { role } = await authorize(
    { ...ctx, db },
    "directory.manage",
    listingResource(row)
  );
  return { row, role };
}
