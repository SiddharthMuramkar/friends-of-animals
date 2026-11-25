// What a directory listing can be and offer (#127). The schema builds its
// enums from these lists, so they can't drift. The service list is FOA's to
// confirm (HR-62); adding one later is a new enum value in its own
// migration.
//
// Loads under plain Node (schema, seed script): no "server-only", no `@/`
// imports.

/** Who is listed: organisations and individuals. */
export const LISTING_TYPES = [
  "ngo",
  "rescue_organisation",
  "shelter",
  "independent_rescuer",
  "foster_caregiver",
] as const;

export type ListingType = (typeof LISTING_TYPES)[number];

/** Listing types that are one person rather than an organisation. */
export const INDIVIDUAL_LISTING_TYPES = [
  "independent_rescuer",
  "foster_caregiver",
] as const satisfies readonly ListingType[];

export function isIndividualListing(type: ListingType): boolean {
  return (INDIVIDUAL_LISTING_TYPES as readonly ListingType[]).includes(type);
}

/** What a listing offers. #128 searches by these. */
export const DIRECTORY_SERVICES = [
  "rescue",
  "shelter",
  "veterinary_care",
  "ambulance",
  "adoption",
  "fostering",
  "feeding",
  "sterilisation",
  "education",
] as const;

export type DirectoryService = (typeof DIRECTORY_SERVICES)[number];

/**
 * The contacts a listing may choose to show the public, one by one. The
 * address is never on this list: the public page shows only city, state
 * and pin code, so an individual rescuer's home stays private (HR-61).
 */
export const PUBLIC_CONTACT_FIELDS = ["phone", "email", "website"] as const;

export type PublicContactField = (typeof PUBLIC_CONTACT_FIELDS)[number];
