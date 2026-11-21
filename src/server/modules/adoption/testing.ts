// Test helpers for the adoption module's Seam 1 tests. Tests only: nothing
// in the app imports this file.
//
// Directory listings (#127) aren't on this branch yet, so tests name them
// by id and say which are verified through `verifiedDirectories`.

import { inArray } from "drizzle-orm";

import type { Harness } from "@/test/harness";

import { insertAdoptionListingDraft } from "./create";
import {
  adoptionListingDetailsSchema,
  type AdoptionListingDetailsInput,
} from "./domain/details";
import type { AdoptionListingStatus } from "./domain/status";
import type { DirectoryVerifiedSql } from "./public-read";
import { transitionAdoptionListing } from "./transition";

/** Directory listing ids, as #127 will make them. */
export const SHELTER_A = "01950000-0000-7000-8000-00000000a001";
export const SHELTER_B = "01950000-0000-7000-8000-00000000b002";
export const SHELTER_C = "01950000-0000-7000-8000-00000000c003";

/** A complete, valid form: Bruno, a two-year-old dog in Pune. */
export const BRUNO: AdoptionListingDetailsInput = {
  name: "Bruno",
  species: "dog",
  breed: "Indie",
  sex: "male",
  size: "medium",
  colour: "Brown and white",
  age: { years: 2, months: 1 },
  sterilised: true,
  about: "Calm, loves long walks.",
  healthNotes: "Healthy. Dewormed in December.",
  vaccinationNotes: "Anti-rabies and DHPPi, December 2026.",
  conditions: "Indoor home only. Home visit before adoption.",
  state: "maharashtra",
  city: "Pune",
  pinCode: "411001",
};

/** The directory "verified" condition, true for `ids` only. */
export function verifiedDirectories(
  ids: readonly string[]
): DirectoryVerifiedSql {
  return (directoryListingId) => inArray(directoryListingId, [...ids]);
}

/** A draft under `directoryListingId`, made by a new member. */
export async function draftListing(
  h: Harness,
  details: Partial<AdoptionListingDetailsInput> = {},
  directoryListingId: string = SHELTER_A
): Promise<{ id: string; slug: string }> {
  const creator = await h.seed.member();
  const parsed = adoptionListingDetailsSchema.parse({ ...BRUNO, ...details });
  return h.db.transaction((tx) =>
    insertAdoptionListingDraft(h.deps, tx, {
      directoryListingId,
      createdByUserId: creator.id,
      details: parsed,
    })
  );
}

/** The moves that take a new draft to `status`, and who makes each. */
const ROUTE: Record<
  AdoptionListingStatus,
  { to: AdoptionListingStatus; by: "representative" | "coordinator" }[]
> = {
  draft: [],
  published: [{ to: "published", by: "representative" }],
  on_hold: [
    { to: "published", by: "representative" },
    { to: "on_hold", by: "representative" },
  ],
  adopted: [
    { to: "published", by: "representative" },
    { to: "adopted", by: "coordinator" },
  ],
  withdrawn: [{ to: "withdrawn", by: "representative" }],
};

/** Moves listing `id` from draft to `status` through the writer. */
export async function moveTo(
  h: Harness,
  id: string,
  status: AdoptionListingStatus
): Promise<void> {
  for (const move of ROUTE[status]) {
    const result = await h.db.transaction((tx) =>
      transitionAdoptionListing(h.deps, tx, { listingId: id, ...move })
    );
    if (!result.ok) {
      throw new Error(`Could not move ${id} to ${move.to}: ${result.error}`);
    }
  }
}

/** A listing in `status`, from a fresh draft. */
export async function listingIn(
  h: Harness,
  status: AdoptionListingStatus,
  details: Partial<AdoptionListingDetailsInput> = {},
  directoryListingId: string = SHELTER_A
): Promise<{ id: string; slug: string }> {
  const listing = await draftListing(h, details, directoryListingId);
  await moveTo(h, listing.id, status);
  return listing;
}
