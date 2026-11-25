// A representative's moves on an adoption listing (#129), through the one
// writer (./transition.ts):
//
//   publishAdoptionListing   draft → published: needs a verified directory
//                            listing and at least one ready photo
//   holdAdoptionListing      published → on hold: out of browse, its page
//                            stays with a notice
//   resumeAdoptionListing    on hold → published: needs a verified
//                            directory listing
//   withdrawAdoptionListing  draft, published or on hold → withdrawn, final
//
// Each returns the slug, so the Server Action can refresh its cache tags.

import { z } from "zod";

import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { adoptionListingManaged } from "./acting-for";
import { publishBlockers, type PublishBlocker } from "./domain/photos";
import type { AdoptionListingStatus } from "./domain/status";
import { photosOf } from "./photo-rows";
import { transitionAdoptionListing } from "./transition";

export type AdoptionMoveInput = { adoptionListingId: string };

type Moved = {
  ok: true;
  slug: string;
  directoryListingId: string;
  status: AdoptionListingStatus;
};

export type AdoptionMoveResult =
  | Moved
  | InvalidInput
  | { ok: false; error: "invalid_transition" | "directory_not_verified" };

export type PublishAdoptionListingResult =
  | AdoptionMoveResult
  | { ok: false; error: "publish_blocked"; blockers: PublishBlocker[] };

const moveInput = z.object({ adoptionListingId: z.uuid() });

async function move(
  ctx: UseCaseContext,
  input: AdoptionMoveInput,
  {
    from,
    to,
  }: { from: AdoptionListingStatus | null; to: AdoptionListingStatus }
): Promise<PublishAdoptionListingResult> {
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const { row, directory, role } = await adoptionListingManaged(
      ctx,
      tx,
      parsed.data.adoptionListingId,
      { lock: true }
    );
    // Publishing is a draft's first move and resuming an on-hold
    // listing's, though both end in published.
    if (from !== null && row.status !== from) {
      return { ok: false, error: "invalid_transition" } as const;
    }
    if (from === "draft") {
      const photos = (await photosOf(tx, [row.id])).get(row.id) ?? [];
      const blockers = publishBlockers({
        directoryVerified: directory.verified,
        photos,
      });
      if (blockers.length > 0) {
        return { ok: false, error: "publish_blocked", blockers } as const;
      }
    }
    if (from === "on_hold" && !directory.verified) {
      return { ok: false, error: "directory_not_verified" } as const;
    }
    const result = await transitionAdoptionListing(ctx, tx, {
      listingId: row.id,
      to,
      by: "representative",
      actorRole: role,
    });
    if (!result.ok) return { ok: false, error: "invalid_transition" } as const;
    return {
      ok: true,
      slug: result.slug,
      directoryListingId: result.directoryListingId,
      status: result.to,
    } as const;
  });
}

export function publishAdoptionListing(
  ctx: UseCaseContext,
  input: AdoptionMoveInput
): Promise<PublishAdoptionListingResult> {
  return move(ctx, input, { from: "draft", to: "published" });
}

export function holdAdoptionListing(
  ctx: UseCaseContext,
  input: AdoptionMoveInput
) {
  return move(ctx, input, {
    from: null,
    to: "on_hold",
  }) as Promise<AdoptionMoveResult>;
}

export function resumeAdoptionListing(
  ctx: UseCaseContext,
  input: AdoptionMoveInput
) {
  return move(ctx, input, {
    from: "on_hold",
    to: "published",
  }) as Promise<AdoptionMoveResult>;
}

export function withdrawAdoptionListing(
  ctx: UseCaseContext,
  input: AdoptionMoveInput
) {
  return move(ctx, input, {
    from: null,
    to: "withdrawn",
  }) as Promise<AdoptionMoveResult>;
}
