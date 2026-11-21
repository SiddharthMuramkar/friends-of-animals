// Writing a new adoption listing (#129). The `createAdoptionListing` use
// case authorizes the actor as a representative of a verified directory
// listing, parses the form with adoptionListingDetailsSchema, then calls
// insertAdoptionListingDraft in the transaction that also writes its audit
// entry. That use case waits for #59 (authorize, audit) and #127 (directory
// listings); this part needs neither.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { AppDb } from "../../db/app-db";
import { adoptionListing } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { Clock } from "../../ports/clock";
import type { AdoptionListingDetails } from "./domain/details";
import { adoptionSlugCandidates } from "./domain/slug";
import { detailColumns } from "./rows";

/**
 * Saves a draft under `directoryListingId` and returns its id and slug: the
 * first slug candidate no other listing holds.
 */
export async function insertAdoptionListingDraft(
  ctx: { clock: Clock },
  tx: AppDb,
  input: {
    directoryListingId: string;
    createdByUserId: string;
    details: AdoptionListingDetails;
  }
): Promise<{ id: string; slug: string }> {
  const now = ctx.clock.now();
  const id = uuidv7(now);
  const { details } = input;
  const values = {
    id,
    directoryListingId: input.directoryListingId,
    ...detailColumns(details, now),
    status: "draft" as const,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };
  const candidates = adoptionSlugCandidates(
    details.name,
    details.species,
    details.city,
    id
  );
  for (const slug of candidates) {
    // A taken slug inserts nothing, so the next candidate is tried
    // without an error aborting the caller's transaction.
    const inserted = await tx
      .insert(adoptionListing)
      .values({ ...values, slug })
      .onConflictDoNothing({ target: adoptionListing.slug })
      .returning({ id: adoptionListing.id });
    if (inserted.length > 0) return { id, slug };
  }
  // The last candidate ends with the listing's own id.
  throw new Error(`No free slug for adoption listing ${id}`);
}
