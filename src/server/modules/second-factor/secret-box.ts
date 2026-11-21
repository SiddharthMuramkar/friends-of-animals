// Sealing TOTP shared secrets at rest. Anyone holding a secret can make
// its codes, so the database stores it encrypted: AES-256-GCM under a key
// derived (HKDF-SHA-256) from Better Auth's secret, bound to the factor's
// id so a sealed value copied onto another row doesn't open.
//
//   v1.<iv>.<ciphertext>.<tag>   (base64url parts)
//
// Rotating BETTER_AUTH_SECRET makes every sealed secret unreadable: the
// owners then enrol again (HR-01 notes this). Loads under plain Node (the
// seed script): no "server-only".

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const INFO = "foa/second-factor/totp/v1";

function keyFor(authSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret, "", INFO, 32));
}

/** Encrypts a TOTP secret for the factor `factorId`. */
export function sealTotpSecret(
  authSecret: string,
  factorId: string,
  secret: Uint8Array
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(authSecret), iv);
  cipher.setAAD(Buffer.from(factorId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/**
 * Decrypts what `sealTotpSecret` made for the same factor. Throws if the
 * value was altered, belongs to another factor or was sealed under another
 * secret.
 */
export function openTotpSecret(
  authSecret: string,
  factorId: string,
  sealed: string
): Uint8Array {
  const [version, iv, ciphertext, tag, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag || rest.length > 0) {
    throw new Error("Not a sealed TOTP secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFor(authSecret),
    Buffer.from(iv, "base64url")
  );
  decipher.setAAD(Buffer.from(factorId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return new Uint8Array(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ])
  );
}
