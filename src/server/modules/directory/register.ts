// Registering a directory listing (#127). A signed-in person sends what
// their organisation (or they, as an independent rescuer or foster
// caregiver) does, where and how to reach them. The listing starts pending
// verification and stays private until FOA staff verify it (./decide.ts).
// One open listing per person: another waits until the first is rejected
// or withdrawn.

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  DIRECTORY_LISTING_SLUG_UNIQUE,
  directoryListing,
} from "../../db/schema";
import { signedInUser } from "../../identity/account";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { isUniqueViolation } from "../codes/codes";
import {
  listingDetailsSchema,
  type ListingDetailsInput,
} from "./domain/listing-input";
import { INITIAL_LISTING_STATUS } from "./domain/listing-status";
import { listingSlugBase, listingSlugCandidate } from "./domain/slug";
import { sealListingDetails } from "./stored-listing";

export type RegisterListingResult =
  | { ok: true; listingId: string; slug: string }
  | InvalidInput
  | { ok: false; error: "already_registered" };

/** How many numbered slugs to try before giving up on a crowded name. */
const SLUG_ATTEMPTS = 50;

const ONE_OPEN_PER_OWNER = "directory_listing_one_open_per_owner";

export async function registerListing(
  ctx: UseCaseContext,
  input: ListingDetailsInput
): Promise<RegisterListingResult> {
  const { role: actorRole } = await authorize(ctx, "directory.register");
  const parsed = listingDetailsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { userId } = signedInUser(ctx);
  const now = ctx.clock.now();
  const id = uuidv7(now);
  const base = listingSlugBase(parsed.data.name);
  const values = {
    id,
    ...sealListingDetails(ctx, parsed.data),
    status: INITIAL_LISTING_STATUS,
    statusChangedAt: now,
    ownerUserId: userId,
    createdAt: now,
    updatedAt: now,
  };

  return ctx.db.transaction(async (tx) => {
    let slug: string | null = null;
    for (let attempt = 1; slug === null; attempt++) {
      if (attempt > SLUG_ATTEMPTS) {
        throw new Error("No free slug for this listing's name");
      }
      const candidate = listingSlugCandidate(base, attempt);
      try {
        // A clash aborts its statement, so each try runs in a savepoint
        // and the transaction survives to try the next one.
        await tx.transaction((savepoint) =>
          savepoint.insert(directoryListing).values({
            ...values,
            slug: candidate,
          })
        );
        slug = candidate;
      } catch (error) {
        if (isUniqueViolation(error, ONE_OPEN_PER_OWNER)) {
          return { ok: false, error: "already_registered" } as const;
        }
        if (!isUniqueViolation(error, DIRECTORY_LISTING_SLUG_UNIQUE)) {
          throw error;
        }
      }
    }

    await recordAudit(tx, ctx, {
      action: "directory.listing_registered",
      entity: { type: "directory_listing", id },
      before: null,
      after: { status: INITIAL_LISTING_STATUS },
      actorRole,
    });
    await emit(tx, ctx.clock, {
      type: "directory.listing_submitted",
      aggregate: { type: "directory_listing", id },
      payload: { listingId: id, userId },
    });
    return { ok: true, listingId: id, slug } as const;
  });
}
