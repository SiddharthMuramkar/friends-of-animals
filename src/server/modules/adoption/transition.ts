// The one writer of an adoption listing's status (#129). Every move goes
// through here: it locks the row, checks the move against the transition
// table (./domain/status.ts), stamps the times and writes the audit row,
// all in the caller's transaction. The caller has authorized the actor.
// #130's coordinator records an adoption with `by: "coordinator"`.

import { eq } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { adoptionListing } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import {
  ADOPTION_LISTING_MOVES,
  canMoveAdoptionListing,
  type AdoptionListingStatus,
  type AdoptionMover,
} from "./domain/status";

export type TransitionAdoptionListingInput = {
  listingId: string;
  to: AdoptionListingStatus;
  by: AdoptionMover;
  /** The role that allowed it, for the audit log. */
  actorRole: Role | null;
};

export type TransitionAdoptionListingResult =
  | {
      ok: true;
      slug: string;
      directoryListingId: string;
      from: AdoptionListingStatus;
      to: AdoptionListingStatus;
    }
  | { ok: false; error: "not_found" | "invalid_transition" };

export async function transitionAdoptionListing(
  ctx: { clock: Clock; actor: Actor },
  tx: AppDb,
  { listingId, to, by, actorRole }: TransitionAdoptionListingInput
): Promise<TransitionAdoptionListingResult> {
  const [row] = await tx
    .select({
      status: adoptionListing.status,
      slug: adoptionListing.slug,
      directoryListingId: adoptionListing.directoryListingId,
      publishedAt: adoptionListing.publishedAt,
    })
    .from(adoptionListing)
    .where(eq(adoptionListing.id, listingId))
    .for("update");
  if (!row) return { ok: false, error: "not_found" };
  const from = row.status;
  if (!canMoveAdoptionListing(from, to, by)) {
    return { ok: false, error: "invalid_transition" };
  }
  const trigger = ADOPTION_LISTING_MOVES.find(
    (move) => move.from === from && move.to === to
  )?.trigger;
  const now = ctx.clock.now();
  const closing = to === "adopted" || to === "withdrawn";
  await tx
    .update(adoptionListing)
    .set({
      status: to,
      updatedAt: now,
      // The first publication dates it in browse; a resume keeps its place.
      ...(to === "published" && row.publishedAt === null
        ? { publishedAt: now }
        : {}),
      ...(closing ? { closedAt: now } : {}),
    })
    .where(eq(adoptionListing.id, listingId));
  await recordAudit(tx, ctx, {
    action: `adoption.listing_${trigger ?? to}`,
    entity: { type: "adoption_listing", id: listingId },
    before: { status: from },
    after: { status: to },
    actorRole,
  });
  return {
    ok: true,
    slug: row.slug,
    directoryListingId: row.directoryListingId,
    from,
    to,
  };
}
