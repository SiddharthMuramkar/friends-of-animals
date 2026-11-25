// Receipt links (#106). A receipt is never an attachment: the donor gets a
// link valid for 7 days (#55; a fixed rule, not a setting). The link holds
// a random 32-byte link token (src/server/crypto/link-token.ts); only its
// SHA-256 is stored, so a database copy can't open receipts and no signing
// secret is needed. A new link is a new token; nothing ever extends an old
// one. Loads under plain Node: relative imports only.

import {
  createLinkToken,
  hashLinkToken,
  isWellFormedLinkToken,
  type LinkToken,
  type RandomBytes,
} from "../../../crypto/link-token";

/** How long a receipt link opens the receipt. */
export const RECEIPT_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** A new link token for the URL, and the hash to store in its place. */
export function mintReceiptLinkToken(random?: RandomBytes): LinkToken {
  return createLinkToken(random);
}

/**
 * The stored hash for a token from a URL, or null when it can't be a token
 * at all (the caller answers "not found" without a lookup).
 */
export function hashReceiptLinkToken(token: string): string | null {
  return isWellFormedLinkToken(token) ? hashLinkToken(token) : null;
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
