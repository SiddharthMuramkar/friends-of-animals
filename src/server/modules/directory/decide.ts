// FOA staff decide about a listing (#127): verify, reject, suspend or
// reinstate it, always with a reason. The status table
// (./domain/listing-status.ts) says which moves exist. The first
// verification makes the person who registered it the listing's
// organisation representative; nobody is granted the role again after
// that, so a revoked representative stays revoked. Each decision writes
// one audit entry and tells the owner, in the transaction that makes it.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { directoryListing, userRole } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { TOMBSTONE } from "../privacy/domain/anonymise";
import { LISTING_CONTACT_PHONE } from "./stored-listing";
import {
  decideListingStatus,
  type ListingOutcome,
  type ListingStatus,
  type StaffListingAction,
} from "./domain/listing-status";

export type DecideListingInput = { listingId: string; reason: string };

export type DecideListingResult =
  | {
      ok: true;
      outcome: ListingOutcome;
      status: ListingStatus;
      /** The public address, so the page's cache can be refreshed. */
      slug: string;
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "transition_not_allowed"
        | "reason_required"
        | "reason_too_long";
    };

const decideInput = z.object({
  listingId: z.uuid(),
  // The status table checks the trimmed length; this only bounds the input.
  reason: z.string().max(10_000),
});

/** Makes `userId` the listing's representative, unless they are already. */
async function grantRepresentative(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  userId: string,
  listingId: string
): Promise<void> {
  const now = ctx.clock.now();
  await tx
    .insert(userRole)
    .values({
      id: uuidv7(now),
      userId,
      role: "organisation_representative",
      scopeType: "organisation",
      scopeId: listingId,
      grantedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      grantedAt: now,
    })
    .onConflictDoNothing();
}

/** One staff decision; the four use cases below name which. */
async function decideListing(
  ctx: UseCaseContext,
  action: StaffListingAction,
  input: DecideListingInput
): Promise<DecideListingResult> {
  const { role: actorRole } = await authorize(ctx, "directory.decide");
  const parsed = decideInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { listingId, reason } = parsed.data;
  const actorUserId = ctx.actor.kind === "user" ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    // Locked, so two staff deciding at once queue and the second sees the
    // first's status.
    const [row] = await tx
      .select({
        slug: directoryListing.slug,
        status: directoryListing.status,
        statusReason: directoryListing.statusReason,
        verifiedAt: directoryListing.verifiedAt,
        ownerUserId: directoryListing.ownerUserId,
        contactPhoneCiphertext: directoryListing.contactPhoneCiphertext,
      })
      .from(directoryListing)
      .where(eq(directoryListing.id, listingId))
      .for("update");
    if (!row) return { ok: false, error: "not_found" } as const;
    // Erasure detaches only closed listings, with no further decisions.
    if (row.ownerUserId === null) {
      return { ok: false, error: "transition_not_allowed" } as const;
    }

    const change = decideListingStatus({ from: row.status, action, reason });
    if (!change.ok) return change;
    // After a privacy handover, the representative must supply new
    // details before staff can publish them.
    if (
      action === "verify" &&
      ctx.cipher.decrypt(LISTING_CONTACT_PHONE, row.contactPhoneCiphertext) ===
        TOMBSTONE
    ) {
      return { ok: false, error: "transition_not_allowed" } as const;
    }
    const now = ctx.clock.now();
    // Only the first verification grants the role: a listing sent back to
    // review and verified again keeps the representatives it has.
    const firstVerification = change.grantsRepresentative && !row.verifiedAt;
    await tx
      .update(directoryListing)
      .set({
        status: change.to,
        statusReason: change.reason,
        statusChangedAt: now,
        statusChangedByUserId: actorUserId,
        ...(firstVerification ? { verifiedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(directoryListing.id, listingId));
    if (firstVerification) {
      await grantRepresentative(tx, ctx, row.ownerUserId, listingId);
    }

    await recordAudit(tx, ctx, {
      action: `directory.listing_${change.outcome}`,
      entity: { type: "directory_listing", id: listingId },
      before: { status: row.status, reason: row.statusReason },
      after: firstVerification
        ? {
            status: change.to,
            reason: change.reason,
            representative: row.ownerUserId,
          }
        : { status: change.to, reason: change.reason },
      actorRole,
    });
    if (change.event) {
      await emit(tx, ctx.clock, {
        type: change.event,
        aggregate: { type: "directory_listing", id: listingId },
        payload: { listingId, userId: row.ownerUserId },
      });
    }
    return {
      ok: true,
      outcome: change.outcome,
      status: change.to,
      slug: row.slug,
    } as const;
  });
}

export const verifyListing = (ctx: UseCaseContext, input: DecideListingInput) =>
  decideListing(ctx, "verify", input);

export const rejectListing = (ctx: UseCaseContext, input: DecideListingInput) =>
  decideListing(ctx, "reject", input);

export const suspendListing = (
  ctx: UseCaseContext,
  input: DecideListingInput
) => decideListing(ctx, "suspend", input);

export const reinstateListing = (
  ctx: UseCaseContext,
  input: DecideListingInput
) => decideListing(ctx, "reinstate", input);
