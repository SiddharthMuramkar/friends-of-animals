// The field cipher: encrypts personal-data columns (phone numbers from #58;
// dates of birth, addresses, guardian details and PAN later) so a leaked
// backup or a raw query shows no plain values. AES-256-GCM with a fresh
// 12-byte IV per value; the purpose (the column, e.g. "user.phone") is bound
// in as additional data, so a value copied into another column won't
// decrypt. Keys come from a versioned key ring (FIELD_ENCRYPTION_KEYS), and
// each stored value names the key version it was written with, so a new key
// can be added without re-encrypting first.
//
// A stored value is "v<version>:<iv>:<ciphertext>:<tag>", each part unpadded
// base64url. To find a row by an encrypted value, store a blind index next to
// it (./blind-index.ts).
//
// Loads under plain Node (seed script), so no "server-only" here.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** A value as an encrypted column stores it. Only `encrypt` makes one. */
export type Ciphertext = string & { readonly __brand: "Ciphertext" };

/** Encryption keys by version; `primary` encrypts, every key decrypts. */
export type KeyRing = {
  primary: number;
  keys: ReadonlyMap<number, Buffer>;
};

export interface FieldCipher {
  /** Encrypts `plaintext` for column `purpose` under the primary key. */
  encrypt(purpose: string, plaintext: string): Ciphertext;
  /**
   * Reads back a value stored for column `purpose`. Throws
   * FieldCipherError if it was changed, stored for another column, or
   * written with a key the ring no longer holds.
   */
  decrypt(purpose: string, stored: string): string;
}

/** 32 bytes in standard base64, as `openssl rand -base64 32` prints them. */
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Reads FIELD_ENCRYPTION_KEYS: comma-separated "<version>:<base64 key>"
 * entries, e.g. "2:<key>,1:<key>". The highest version encrypts new values;
 * every listed key still decrypts, so a key is retired only after every
 * value stored under it has been re-encrypted.
 */
export function parseKeyRing(value: string): KeyRing {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) {
    throw new KeyRingError("FIELD_ENCRYPTION_KEYS is empty");
  }
  const keys = new Map<number, Buffer>();
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    if (colon === -1) {
      throw new KeyRingError(
        'Each FIELD_ENCRYPTION_KEYS entry is "<version>:<key>"'
      );
    }
    const version = entry.slice(0, colon).trim();
    const key = entry.slice(colon + 1).trim();
    if (!/^[1-9]\d{0,5}$/.test(version)) {
      throw new KeyRingError(
        "Key versions in FIELD_ENCRYPTION_KEYS are whole numbers from 1"
      );
    }
    if (!BASE64_KEY.test(key)) {
      throw new KeyRingError(
        `Key version ${version} in FIELD_ENCRYPTION_KEYS is not 32 bytes ` +
          "of base64; make one with `openssl rand -base64 32`"
      );
    }
    if (keys.has(Number(version))) {
      throw new KeyRingError(
        `Key version ${version} appears twice in FIELD_ENCRYPTION_KEYS`
      );
    }
    keys.set(Number(version), Buffer.from(key, "base64"));
  }
  return { primary: Math.max(...keys.keys()), keys };
}

/** FIELD_ENCRYPTION_KEYS is malformed. The message never holds a key. */
export class KeyRingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRingError";
  }
}

/** A stored value can't be read. The message never holds the value. */
export class FieldCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldCipherError";
  }
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** "v<version>:<iv>:<ciphertext>:<tag>", each part unpadded base64url. */
const STORED = /^v([1-9]\d{0,5}):([\w-]{16}):([\w-]*):([\w-]{22})$/;

export function createFieldCipher(ring: KeyRing): FieldCipher {
  return {
    encrypt(purpose, plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(
        ALGORITHM,
        ring.keys.get(ring.primary)!,
        iv,
        { authTagLength: TAG_BYTES }
      );
      cipher.setAAD(Buffer.from(purpose));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return [
        `v${ring.primary}`,
        iv.toString("base64url"),
        body.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join(":") as Ciphertext;
    },
    decrypt(purpose, stored) {
      const parts = STORED.exec(stored);
      if (!parts) {
        throw new FieldCipherError("Not a value stored by the field cipher");
      }
      const [, version, iv, body, tag] = parts;
      const key = ring.keys.get(Number(version));
      if (!key) {
        throw new FieldCipherError(
          `No key with version ${version} in FIELD_ENCRYPTION_KEYS`
        );
      }
      try {
        const decipher = createDecipheriv(
          ALGORITHM,
          key,
          Buffer.from(iv!, "base64url"),
          { authTagLength: TAG_BYTES }
        );
        decipher.setAAD(Buffer.from(purpose));
        decipher.setAuthTag(Buffer.from(tag!, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(body!, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new FieldCipherError(
          `A stored ${purpose} value failed its integrity check: it was ` +
            "changed, or stored for another column or with another key"
        );
      }
    },
  };
}
