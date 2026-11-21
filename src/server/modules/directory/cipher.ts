// How the directory keeps a listing's address and contact phone unreadable
// at rest: the field cipher #58 adds to the use-case deps as `cipher`
// (src/server/crypto/field-cipher.ts on its branch). This module depends
// only on the two methods it calls, so #58's FieldCipher fits as it is.
//
// Until #58 lands, the deps hold no cipher: use cases that read or write
// those columns fail closed with FieldCipherNotWiredError, and tests pass
// one in (./testing.ts). Once `Deps.cipher` exists, `listingCipherOf`
// returns it and the fallback goes.
//
// Loads under plain Node (seed script): relative imports only.

/** The field cipher's methods, as #58's FieldCipher declares them. */
export interface ListingCipher {
  /** Encrypts `plaintext` for column `purpose`. */
  encrypt(purpose: string, plaintext: string): string;
  /** Reads back a value stored for column `purpose`; throws if tampered. */
  decrypt(purpose: string, stored: string): string;
}

/** The cipher purposes: one per encrypted column, bound into each value. */
export const LISTING_CIPHER_PURPOSES = {
  address: "directory_listing.address",
  contactPhone: "directory_listing.contact_phone",
} as const;

export class FieldCipherNotWiredError extends Error {
  constructor() {
    super(
      "The field cipher isn't in the deps yet (#58), so a listing's " +
        "address and phone can't be stored or read."
    );
    this.name = "FieldCipherNotWiredError";
  }
}

const unwiredCipher: ListingCipher = {
  encrypt() {
    throw new FieldCipherNotWiredError();
  },
  decrypt() {
    throw new FieldCipherNotWiredError();
  },
};

/** The deps' field cipher, or one that refuses every call until #58. */
export function listingCipherOf(deps: {
  cipher?: ListingCipher | undefined;
}): ListingCipher {
  return deps.cipher ?? unwiredCipher;
}
