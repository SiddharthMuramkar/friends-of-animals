import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  RECEIPT_LINK_LIFETIME_MS,
  hashReceiptLinkToken,
  mintReceiptLinkToken,
  receiptLinkExpiresAt,
  receiptLinkState,
} from "./receipt-link";

const fixedBytes = (fill: number) => (length: number) =>
  new Uint8Array(length).fill(fill);

describe("mintReceiptLinkToken", () => {
  it("makes a 32-byte URL-safe token and stores only its SHA-256", () => {
    const { token, tokenHash } = mintReceiptLinkToken(fixedBytes(0xab));
    expect(token).toBe(Buffer.alloc(32, 0xab).toString("base64url"));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(tokenHash).not.toContain(token);
  });

  it("makes a different token every time by default", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => mintReceiptLinkToken().token)
    );
    expect(tokens.size).toBe(50);
  });
});

describe("hashReceiptLinkToken", () => {
  it("hashes a token the way minting did", () => {
    const { token, tokenHash } = mintReceiptLinkToken();
    expect(hashReceiptLinkToken(token)).toBe(tokenHash);
  });

  it.each([
    ["empty", ""],
    ["too short", "abc"],
    ["too long", "a".repeat(44)],
    ["not URL-safe", `${"a".repeat(42)}+`],
    ["padded", `${"a".repeat(42)}=`],
  ])("refuses a %s token without hashing it", (_, token) => {
    expect(hashReceiptLinkToken(token)).toBeNull();
  });
});

describe("receipt link lifetime", () => {
  const issuedAt = new Date("2027-01-15T04:30:00.000Z");
  const expiresAt = receiptLinkExpiresAt(issuedAt);

  it("is exactly 7 days, a fixed rule rather than a setting", () => {
    expect(RECEIPT_LINK_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(expiresAt.toISOString()).toBe("2027-01-22T04:30:00.000Z");
  });

  it.each([
    ["when issued", 0, "valid"],
    ["a moment before 7 days", RECEIPT_LINK_LIFETIME_MS - 1, "valid"],
    ["at 7 days", RECEIPT_LINK_LIFETIME_MS, "expired"],
    ["7 days and 1 second later", RECEIPT_LINK_LIFETIME_MS + 1000, "expired"],
  ] as const)("is %s: %s", (_, elapsed, state) => {
    const now = new Date(issuedAt.getTime() + elapsed);
    expect(receiptLinkState({ expiresAt }, now)).toBe(state);
  });
});
