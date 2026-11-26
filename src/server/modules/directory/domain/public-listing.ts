// What the public sees of a listing (#127): nothing until it is verified,
// then its own description of itself and only the contacts it chose. The
// address, owner, documents and staff reasons never leave the server
// through this read model.
//
// Loads under plain Node: relative imports only, no "server-only".

import type {
  DirectoryService,
  ListingType,
  PublicContactField,
} from "./catalogue";
import type { ListingDetails } from "./listing-input";
import { isPubliclyListed, type ListingStatus } from "./listing-status";

/** A listing as the module holds it after decrypting its columns. */
export type StoredListing = ListingDetails & {
  id: string;
  slug: string;
  status: ListingStatus;
  ownerUserId: string | null;
  statusReason: string | null;
};

export type PublicListing = {
  slug: string;
  type: ListingType;
  name: string;
  description: string;
  services: DirectoryService[];
  city: string;
  state: string;
  pinCode: string;
  contact: Partial<Record<PublicContactField, string>>;
};

/** The public view of `listing`, or null while it isn't verified. */
export function toPublicListing(listing: StoredListing): PublicListing | null {
  if (!isPubliclyListed(listing.status)) return null;
  const values: Record<PublicContactField, string | null> = {
    phone: listing.contactPhone,
    email: listing.contactEmail,
    website: listing.website,
  };
  const contact: Partial<Record<PublicContactField, string>> = {};
  for (const field of listing.publicContactFields) {
    const value = values[field];
    if (value !== null) contact[field] = value;
  }
  return {
    slug: listing.slug,
    type: listing.type,
    name: listing.name,
    description: listing.description,
    services: [...listing.services],
    city: listing.city,
    state: listing.state,
    pinCode: listing.pinCode,
    contact,
  };
}
