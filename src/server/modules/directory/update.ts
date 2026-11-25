// A listing's own people change it (#127): its registrant until FOA first
// verifies it, then its organisation representatives (./acting-for.ts).
//
//   updateListing({ listingId, ...details }) → detail edits on a verified
//       listing go live at once; a new name or type sends it back to
//       review, because verification vouches for who the organisation is
//   withdrawListing({ listingId, reason? })  → off the directory, for good
//
// Staff don't edit what an organisation says about itself. Each change
// writes one audit entry naming the changed fields, never their values.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../../audit/record";
import { directoryListing } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { listingActedFor } from "./acting-for";
import { planListingEdit } from "./domain/listing-edit";
import {
  listingDetailsSchema,
  type ListingDetailsInput,
} from "./domain/listing-input";
import {
  decideListingStatus,
  type ListingStatus,
} from "./domain/listing-status";
import { openListingDetails, sealListingDetails } from "./stored-listing";

export type UpdateListingInput = ListingDetailsInput & { listingId: string };

export type UpdateListingResult =
  | {
      ok: true;
      changed: boolean;
      /** A new name or type sent a verified listing back to review. */
      resubmitted: boolean;
      status: ListingStatus;
      slug: string;
    }
  | InvalidInput
  | { ok: false; error: "listing_not_editable" };

const listingIdInput = z.object({ listingId: z.uuid() });

export async function updateListing(
  ctx: UseCaseContext,
  input: UpdateListingInput
): Promise<UpdateListingResult> {
  const id = listingIdInput.safeParse(input);
  if (!id.success) return invalidInput(id.error);
  const { listingId } = id.data;

  return ctx.db.transaction(async (tx) => {
    const { row, role } = await listingActedFor(ctx, tx, listingId, {
      lock: true,
    });
    const parsed = listingDetailsSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const plan = planListingEdit({
      from: row.status,
      before: openListingDetails(ctx, row),
      after: parsed.data,
    });
    if (!plan.ok) return plan;
    if (!plan.changed) {
      return {
        ok: true,
        changed: false,
        resubmitted: false,
        status: row.status,
        slug: row.slug,
      };
    }

    const now = ctx.clock.now();
    const resubmitted = plan.to !== row.status;
    await tx
      .update(directoryListing)
      .set({
        ...sealListingDetails(ctx, parsed.data),
        updatedAt: now,
        ...(resubmitted
          ? {
              status: plan.to,
              statusReason: null,
              statusChangedAt: now,
              statusChangedByUserId:
                ctx.actor.kind === "user" ? ctx.actor.userId : null,
            }
          : {}),
      })
      .where(eq(directoryListing.id, listingId));
    await recordAudit(tx, ctx, {
      action: `directory.listing_${plan.outcome}`,
      entity: { type: "directory_listing", id: listingId },
      before: resubmitted ? { status: row.status } : null,
      after: {
        fields: plan.fields,
        ...(resubmitted ? { status: plan.to } : {}),
      },
      actorRole: role,
    });
    if (plan.event && row.ownerUserId !== null) {
      await emit(tx, ctx.clock, {
        type: plan.event,
        aggregate: { type: "directory_listing", id: listingId },
        payload: { listingId, userId: row.ownerUserId },
      });
    }
    return {
      ok: true,
      changed: true,
      resubmitted,
      status: plan.to,
      slug: row.slug,
    };
  });
}

export type WithdrawListingInput = { listingId: string; reason?: string };

export type WithdrawListingResult =
  | { ok: true; status: "withdrawn"; slug: string }
  | InvalidInput
  | { ok: false; error: "transition_not_allowed" | "reason_too_long" };

const withdrawInput = listingIdInput.extend({
  // The status table checks the trimmed length; this only bounds the input.
  reason: z.string().max(10_000).optional(),
});

export async function withdrawListing(
  ctx: UseCaseContext,
  input: WithdrawListingInput
): Promise<WithdrawListingResult> {
  const parsed = withdrawInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { listingId, reason } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const { row, role } = await listingActedFor(ctx, tx, listingId, {
      lock: true,
    });
    const change = decideListingStatus({
      from: row.status,
      action: "withdraw",
      reason,
    });
    if (!change.ok) {
      return {
        ok: false,
        error:
          change.error === "reason_too_long"
            ? "reason_too_long"
            : "transition_not_allowed",
      } as const;
    }
    const now = ctx.clock.now();
    await tx
      .update(directoryListing)
      .set({
        status: change.to,
        statusReason: change.reason,
        statusChangedAt: now,
        statusChangedByUserId:
          ctx.actor.kind === "user" ? ctx.actor.userId : null,
        updatedAt: now,
      })
      .where(eq(directoryListing.id, listingId));
    await recordAudit(tx, ctx, {
      action: "directory.listing_withdrawn",
      entity: { type: "directory_listing", id: listingId },
      before: { status: row.status, reason: row.statusReason },
      after: { status: change.to, reason: change.reason },
      actorRole: role,
    });
    return { ok: true, status: "withdrawn", slug: row.slug } as const;
  });
}
