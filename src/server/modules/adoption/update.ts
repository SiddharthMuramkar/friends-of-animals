// Editing an adoption listing (#129). A representative may change an
// animal's details while it is a draft, published or on hold; an adopted
// or withdrawn listing is closed. Edits to a public listing show at once
// (no review: FOA's lever is the directory listing). The slug never
// changes, so shared links keep working.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../../audit/record";
import { adoptionListing } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { adoptionListingManaged } from "./acting-for";
import {
  adoptionListingDetailsSchema,
  type AdoptionListingDetailsInput,
} from "./domain/details";
import { acceptsChanges, type AdoptionListingStatus } from "./domain/status";
import { detailsColumns } from "./stored";

export type UpdateAdoptionListingInput = AdoptionListingDetailsInput & {
  adoptionListingId: string;
};

export type UpdateAdoptionListingResult =
  | {
      ok: true;
      slug: string;
      status: AdoptionListingStatus;
      directoryListingId: string;
      /** False when nothing differed from what was stored. */
      changed: boolean;
    }
  | InvalidInput
  | { ok: false; error: "listing_closed" | "directory_not_verified" };

const target = z.object({ adoptionListingId: z.uuid() });

export async function updateAdoptionListing(
  ctx: UseCaseContext,
  input: UpdateAdoptionListingInput
): Promise<UpdateAdoptionListingResult> {
  const parsedTarget = target.safeParse(input);
  if (!parsedTarget.success) return invalidInput(parsedTarget.error);

  return ctx.db.transaction(async (tx) => {
    const { row, directory, role } = await adoptionListingManaged(
      ctx,
      tx,
      parsedTarget.data.adoptionListingId,
      { lock: true }
    );
    if (!acceptsChanges(row.status)) {
      return { ok: false, error: "listing_closed" } as const;
    }
    if (!directory.verified) {
      return { ok: false, error: "directory_not_verified" } as const;
    }
    const parsed = adoptionListingDetailsSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);

    const now = ctx.clock.now();
    const columns = detailsColumns(parsed.data, now);
    const changedFields = (
      Object.keys(columns) as (keyof typeof columns)[]
    ).filter((key) => columns[key] !== row[key]);
    const result = {
      ok: true,
      slug: row.slug,
      status: row.status,
      directoryListingId: row.directoryListingId,
      changed: changedFields.length > 0,
    } as const;
    if (!result.changed) return result;

    await tx
      .update(adoptionListing)
      .set({ ...columns, updatedAt: now })
      .where(eq(adoptionListing.id, row.id));
    await recordAudit(tx, ctx, {
      action: "adoption.listing_updated",
      entity: { type: "adoption_listing", id: row.id },
      before: null,
      // Names only: what changed, for the log; the listing holds the rest.
      after: { fields: changedFields.toSorted() },
      actorRole: role,
    });
    return result;
  });
}
