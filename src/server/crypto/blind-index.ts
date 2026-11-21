// Blind indexes: a keyed hash (HMAC-SHA-256) of a personal-data value, stored
// next to its encrypted copy so the app can find a row by that value, such as
// a user by phone number at sign-in, without storing the value readably.
// Without FIELD_HMAC_KEY nobody can work out which value an index belongs
// to. The purpose (the column, e.g. "user.phone") is hashed in, so one value
// gets a different index in every column.
//
// Callers normalise first (a phone number goes in as E.164, see
// src/lib/phone.ts), or two spellings of one value get two indexes.
//
// Changing the derivation, or the key, changes every index: rows stored
// before stop matching until each is recomputed from its decrypted value.
//
// Loads under plain Node (seed script), so no "server-only" here.

import { createHmac } from "node:crypto";

/** The key behind every blind index (FIELD_HMAC_KEY). */
export type BlindIndexKey = Buffer & { readonly __brand: "BlindIndexKey" };

export interface BlindIndex {
  /** The index of an already normalised `value` stored in column `purpose`. */
  of(purpose: string, value: string): string;
}

/** FIELD_HMAC_KEY or a purpose is unusable. Never holds a key or value. */
export class BlindIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlindIndexError";
  }
}

/** 32 bytes in standard base64, as `openssl rand -base64 32` prints them. */
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

/** Reads FIELD_HMAC_KEY. */
export function parseBlindIndexKey(value: string): BlindIndexKey {
  const key = value.trim();
  if (!BASE64_KEY.test(key)) {
    throw new BlindIndexError(
      "FIELD_HMAC_KEY is not 32 bytes of base64; make one with " +
        "`openssl rand -base64 32`"
    );
  }
  return Buffer.from(key, "base64") as BlindIndexKey;
}

export function createBlindIndex(key: BlindIndexKey): BlindIndex {
  return {
    of(purpose, value) {
      // The NUL separator keeps ("a", "b\0c") and ("a\0b", "c") apart.
      if (purpose === "" || purpose.includes("\0")) {
        throw new BlindIndexError(
          "A blind index purpose names its column and holds no NUL"
        );
      }
      return createHmac("sha256", key)
        .update(`${purpose}\0${value}`)
        .digest("hex");
    },
  };
}
