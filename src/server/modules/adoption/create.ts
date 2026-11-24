// Creating an adoption listing (#129). A representative of a verified
// directory listing writes a draft about one animal; it stays private
// until they publish it (./lifecycle.ts) with at least one ready photo.

import { z } from "zod";

import { recordAudit } from "../../audit/record";
import { ADOPTION_LISTING_SLUG_UNIQUE, adoptionListing } from "../../db/schema";
import { signedInUser } from "../../identity/account";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { isUniqueViolation } from "../codes/codes";
import { directoryManaged } from "./acting-for";
import {
  adoptionListingDetailsSchema,
  type AdoptionListingDetailsInput,
} from "./domain/details";
import { adoptionSlugCandidates } from "./domain/slug";
import { moveAdoptionListing } from "./domain/status";
import { detailsColumns } from "./stored";

export type CreateAdoptionListingInput = AdoptionListingDetailsInput & {
  directoryListingId: string;
};

export type CreateAdoptionListingResult =
  | { ok: true; adoptionListingId: string; slug: string }
  | InvalidInput
  | { ok: false; error: "directory_not_verified" };

const directoryInput = z.object({ directoryListingId: z.uuid() });

export async function createAdoptionListing(
  ctx: UseCaseContext,
  input: CreateAdoptionListingInput
): Promise<CreateAdoptionListingResult> {
  const target = directoryInput.safeParse(input);
  if (!target.success) return invalidInput(target.error);
  const { directoryListingId } = target.data;

  return ctx.db.transaction(async (tx) => {
    const { directory, role } = await directoryManaged(
      ctx,
      tx,
      directoryListingId
    );
    if (!directory.verified) {
      return { ok: false, error: "directory_not_verified" } as const;
    }
    const parsed = adoptionListingDetailsSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const details = parsed.data;

    const now = ctx.clock.now();
    const id = uuidv7(now);
    const status = moveAdoptionListing(null, "draft", "representative");
    const values = {
      id,
      directoryListingId,
      ...detailsColumns(details, now),
      status,
      createdByUserId: signedInUser(ctx).userId,
      createdAt: now,
      updatedAt: now,
    };
    let slug: string | null = null;
    for (const candidate of adoptionSlugCandidates(
      details.name,
      details.species,
      details.city,
      id
    )) {
      try {
        // A clash aborts its statement, so each try runs in a savepoint.
        await tx.transaction((savepoint) =>
          savepoint
            .insert(adoptionListing)
            .values({ ...values, slug: candidate })
        );
        slug = candidate;
        break;
      } catch (error) {
        if (!isUniqueViolation(error, ADOPTION_LISTING_SLUG_UNIQUE))
          throw error;
      }
    }
    // The last candidate ends in the listing's own id, which no other
    // listing's slug can.
    if (slug === null) throw new Error("No free slug for this animal");

    await recordAudit(tx, ctx, {
      action: "adoption.listing_created",
      entity: { type: "adoption_listing", id },
      before: null,
      after: { status, directoryListingId },
      actorRole: role,
    });
    return { ok: true, adoptionListingId: id, slug } as const;
  });
}
