// How a listing row keeps its contact details, and how the module reads a
// row back (#127). The address, phone and email are encrypted with the
// field cipher, each bound to its own column, so a raw query or a leaked
// backup shows none of them.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";
import type { DirectoryListingRow } from "../../db/schema";
import type { PublicContactField } from "./domain/catalogue";
import type { ListingDetails } from "./domain/listing-input";
import type { StoredListing } from "./domain/public-listing";

/** The purposes the cipher binds each value to. */
export const LISTING_ADDRESS = "directory_listing.address";
export const LISTING_CONTACT_PHONE = "directory_listing.contact_phone";
export const LISTING_CONTACT_EMAIL = "directory_listing.contact_email";

type SealedContacts = {
  addressCiphertext: Ciphertext;
  contactPhoneCiphertext: Ciphertext;
  contactEmailCiphertext: Ciphertext | null;
};

/** The columns a listing's details are stored in. */
export function sealListingDetails(
  { cipher }: { cipher: FieldCipher },
  details: ListingDetails
) {
  const { address, contactPhone, contactEmail, ...plain } = details;
  const sealed: SealedContacts = {
    addressCiphertext: cipher.encrypt(LISTING_ADDRESS, address),
    contactPhoneCiphertext: cipher.encrypt(LISTING_CONTACT_PHONE, contactPhone),
    contactEmailCiphertext:
      contactEmail === null
        ? null
        : cipher.encrypt(LISTING_CONTACT_EMAIL, contactEmail),
  };
  return { ...plain, ...sealed };
}

/** A listing's details, read back. */
export function openListingDetails(
  { cipher }: { cipher: FieldCipher },
  row: DirectoryListingRow
): ListingDetails {
  return {
    type: row.type,
    name: row.name,
    description: row.description,
    services: row.services,
    address: cipher.decrypt(LISTING_ADDRESS, row.addressCiphertext),
    city: row.city,
    state: row.state,
    pinCode: row.pinCode,
    contactPhone: cipher.decrypt(
      LISTING_CONTACT_PHONE,
      row.contactPhoneCiphertext
    ),
    contactEmail:
      row.contactEmailCiphertext === null
        ? null
        : cipher.decrypt(LISTING_CONTACT_EMAIL, row.contactEmailCiphertext),
    website: row.website,
    publicContactFields: row.publicContactFields as PublicContactField[],
  };
}

/** The row as the module holds it, decrypted. */
export function storedListingOf(
  ctx: { cipher: FieldCipher },
  row: DirectoryListingRow
): StoredListing {
  return {
    ...openListingDetails(ctx, row),
    id: row.id,
    slug: row.slug,
    status: row.status,
    ownerUserId: row.ownerUserId,
    statusReason: row.statusReason,
  };
}
