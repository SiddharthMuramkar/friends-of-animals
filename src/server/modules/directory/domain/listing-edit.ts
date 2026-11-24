// What an edit to a listing does (#127): which fields changed, whether that
// sends a verified listing back to review, and who may make it.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  LISTING_FIELDS,
  type ListingDetails,
  type ListingField,
} from "./listing-input";
import {
  decideListingStatus,
  type DirectoryEvent,
  type ListingOutcome,
  type ListingStatus,
} from "./listing-status";

/**
 * Fields that say who the organisation is. Verification vouches for them,
 * so changing one on a verified listing sends it back to review.
 */
export const IDENTITY_FIELDS = [
  "type",
  "name",
] as const satisfies readonly ListingField[];

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item) => b.includes(item));
  }
  return a === b;
}

/** The fields whose values differ, in form order. Lists compare as sets. */
export function changedListingFields(
  before: ListingDetails,
  after: ListingDetails
): ListingField[] {
  return LISTING_FIELDS.filter((field) => !sameValue(before[field], after[field]));
}

export type ListingEditPlan =
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      /** Names only: the audit row records these, never the values. */
      fields: ListingField[];
      to: ListingStatus;
      outcome: ListingOutcome;
      event: DirectoryEvent | null;
    }
  | { ok: false; error: "listing_not_editable" };

/** What saving `after` over `before` does to a listing in status `from`. */
export function planListingEdit(input: {
  from: ListingStatus;
  before: ListingDetails;
  after: ListingDetails;
}): ListingEditPlan {
  const fields = changedListingFields(input.before, input.after);
  const action = fields.some((field) =>
    (IDENTITY_FIELDS as readonly ListingField[]).includes(field)
  )
    ? "edit_identity"
    : "edit_details";
  const change = decideListingStatus({ from: input.from, action });
  if (!change.ok) return { ok: false, error: "listing_not_editable" };
  if (fields.length === 0) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    fields,
    to: change.to,
    outcome: change.outcome,
    event: change.event,
  };
}

/** The resource shape `authorize()` matches grants against. */
export type ListingResource = {
  scopes: { type: "organisation"; id: string }[];
  ownerId?: string;
};

/**
 * Who may act for a listing (read it in full, edit, withdraw, upload its
 * documents), as an authorization resource. The organisation_representative
 * role at this listing's scope always counts. The person who registered it
 * counts as well only until FOA first verifies it, when nobody holds the
 * role yet; after that the role is the only authority, so revoking it takes
 * effect even for the listing's creator, and sending the listing back to
 * review (a renamed organisation) doesn't hand it back to them.
 */
export function listingResource(listing: {
  id: string;
  ownerUserId: string;
  verifiedAt: Date | null;
}): ListingResource {
  const scopes = [{ type: "organisation" as const, id: listing.id }];
  return listing.verifiedAt === null
    ? { scopes, ownerId: listing.ownerUserId }
    : { scopes };
}
