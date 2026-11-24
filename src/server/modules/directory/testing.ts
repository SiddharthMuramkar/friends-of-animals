// Test helpers for the directory module. Tests only: nothing in the app
// imports this file.

import type { Harness } from "@/test/harness";

import type { ListingDetailsInput } from "./domain/listing-input";

/** A registration that passes every check: an NGO in Pune. */
export function validListing(
  overrides: Partial<ListingDetailsInput> = {}
): ListingDetailsInput {
  return {
    type: "ngo",
    name: "Paws Trust",
    description: "We rescue and treat street animals in Pune.",
    services: ["veterinary_care", "rescue"],
    address: "12 Lane 4, Koregaon Park",
    city: "Pune",
    state: "Maharashtra",
    pinCode: "411001",
    contactPhone: "98765 43210",
    contactEmail: "Hello@PawsTrust.example.test",
    website: "pawstrust.example.test",
    publicContactFields: ["email", "website"],
    ...overrides,
  };
}

/** A signed-in user holding `role` globally (a staff admin, by default). */
export async function signedInStaff(
  h: Harness,
  role: "staff_admin" | "super_admin" | "community_manager" = "staff_admin"
) {
  const user = await h.seed.member();
  await h.seed.grant(user, { role, scope: { type: "global" } });
  return h.signIn(user);
}

/**
 * A signed-in member who has registered a listing, and its id and slug.
 * Pass `listing` to change what they send.
 */
export async function registeredListing(
  h: Harness,
  listing: Partial<ListingDetailsInput> = {}
) {
  const person = await h.seed.member();
  const actor = await h.signIn(person);
  const result = await h.as(actor).registerListing(validListing(listing));
  if (!result.ok) {
    throw new Error(`Could not register a listing: ${result.error}`);
  }
  return {
    person,
    actor,
    listingId: result.listingId,
    slug: result.slug,
  };
}

/** A registered listing that a staff admin has verified. */
export async function verifiedListing(
  h: Harness,
  listing: Partial<ListingDetailsInput> = {}
) {
  const registered = await registeredListing(h, listing);
  const staff = await signedInStaff(h);
  const verified = await h.as(staff).verifyListing({
    listingId: registered.listingId,
    reason: "Checked the trust deed.",
  });
  if (!verified.ok) throw new Error(`Could not verify: ${verified.error}`);
  return { ...registered, staff };
}
