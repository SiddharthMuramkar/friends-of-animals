// Finding what the actor manages (#129): a directory listing they
// represent, or one of its adoption listings, with the policy asked
// against the directory listing's scope. Something that doesn't exist is
// refused like something the actor may not touch, so ids can't be probed.

import { eq } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { Resource } from "../../access/domain/policy";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import {
  adoptionListing,
  directoryListing,
  type AdoptionListingRow,
} from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { isPubliclyListed } from "../directory/domain/listing-status";

/** The scope a directory listing's representatives hold. */
export function organisationResource(directoryListingId: string): Resource {
  return { scopes: [{ type: "organisation", id: directoryListingId }] };
}

export type ManagedDirectory = {
  id: string;
  name: string;
  slug: string;
  /** Whether the directory listing is verified, so its animals can show. */
  verified: boolean;
  /** Where it works, as it typed it: a new animal's form starts there. */
  city: string;
  state: string;
  pinCode: string;
};

function refused(ctx: UseCaseContext): never {
  throw new DomainError(
    "forbidden",
    `${ctx.actor.kind} may not adoption.listing.manage`
  );
}

async function directoryRow(db: AppDb, id: string) {
  const [row] = await db
    .select({
      id: directoryListing.id,
      name: directoryListing.name,
      slug: directoryListing.slug,
      status: directoryListing.status,
      city: directoryListing.city,
      state: directoryListing.state,
      pinCode: directoryListing.pinCode,
    })
    .from(directoryListing)
    .where(eq(directoryListing.id, id));
  return row
    ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        verified: isPubliclyListed(row.status),
        city: row.city,
        state: row.state,
        pinCode: row.pinCode,
      }
    : null;
}

/** The directory listing, if the actor represents it; throws otherwise. */
export async function directoryManaged(
  ctx: UseCaseContext,
  db: AppDb,
  directoryListingId: string
): Promise<{ directory: ManagedDirectory; role: Role | null }> {
  const directory = await directoryRow(db, directoryListingId);
  if (!directory) refused(ctx);
  const { role } = await authorize(
    { ...ctx, db },
    "adoption.listing.manage",
    organisationResource(directory.id)
  );
  return { directory, role };
}

/**
 * The adoption listing (locked when `lock` is set, inside the caller's
 * transaction), its directory listing, and the role that let the actor
 * manage it. Throws forbidden otherwise.
 */
export async function adoptionListingManaged(
  ctx: UseCaseContext,
  db: AppDb,
  adoptionListingId: string,
  { lock = false }: { lock?: boolean } = {}
): Promise<{
  row: AdoptionListingRow;
  directory: ManagedDirectory;
  role: Role | null;
}> {
  const query = db
    .select()
    .from(adoptionListing)
    .where(eq(adoptionListing.id, adoptionListingId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) refused(ctx);
  const { directory, role } = await directoryManaged(
    ctx,
    db,
    row.directoryListingId
  );
  return { row, directory, role };
}
