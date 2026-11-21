// Receipt links (#106). A receipt is never an attachment: the donor gets a
// link valid for 7 days (#55; a fixed rule, not a setting). The link holds
// a random 32-byte token; only its SHA-256 is stored, so a database copy
// can't open receipts and no signing secret is needed. A new link is a new
// token; an old one stays expired.

import { createHash } from "node:crypto";

/** How long a receipt link opens the receipt. */
export const RECEIPT_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;

/** 32 bytes in unpadded base64url are 43 URL-safe characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Returns `length` random bytes; tests pass a fixed source. */
export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

const sha256Hex = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** A new link token for the URL, and the hash to store in its place. */
export function mintReceiptLinkToken(random: RandomBytes = cryptoRandomBytes): {
  token: string;
  tokenHash: string;
} {
  const token = Buffer.from(random(TOKEN_BYTES)).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

/**
 * The stored hash for a token from a URL, or null when it can't be a token
 * at all (the caller answers "not found" without a lookup).
 */
export function hashReceiptLinkToken(token: string): string | null {
  return TOKEN_SHAPE.test(token) ? sha256Hex(token) : null;
}

/** When a link issued at `issuedAt` stops working. */
export function receiptLinkExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + RECEIPT_LINK_LIFETIME_MS);
}

/** Whether a link still opens its receipt at `now`. */
export function receiptLinkState(
  link: { expiresAt: Date },
  now: Date
): "valid" | "expired" {
  return now.getTime() < link.expiresAt.getTime() ? "valid" : "expired";
}
