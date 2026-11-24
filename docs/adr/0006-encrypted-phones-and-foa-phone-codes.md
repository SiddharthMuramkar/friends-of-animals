---
Status: accepted
---

# Phones are encrypted fields found by blind index, and FOA owns phone codes

A User's phone is personal data, so the user table stores it only encrypted
(AES-256-GCM, a fresh IV per value, the column bound in) and finds it through
a blind index, an HMAC of the E.164 number. The keys are deps built once from
`FIELD_ENCRYPTION_KEYS` (a versioned key ring) and `FIELD_HMAC_KEY`, not read
by the column type itself, so the Seam 1 harness gives every test fresh keys
and the column's value type admits only the cipher's output. Because of that,
Better Auth's phoneNumber plugin can't be used: it wants a plain, queryable
number and hands the raw number to its send hook. Phone codes are FOA's own,
in Better Auth's `verification` table under the blind index with email's
rules, and a verified phone starts its session through a server-only Better
Auth endpoint that is never on the HTTP router.

## Considered options

- A Drizzle column type that encrypts itself with a key ring read at import:
  hides the keys, but can't take the harness's keys, and `eq(column, value)`
  silently never matches (random IV).
- Better Auth's phoneNumber plugin with the blind index in its `phoneNumber`
  column: needs a side channel for the raw number and fake emails for
  phone-only users.
- A custom Better Auth plugin for phone codes: the logic would sit behind
  Better Auth endpoints, out of reach of `as(actor)` use cases.

## Consequences

- Email is nullable: an account made by phone has none. A check keeps every
  account reachable by an email or a phone.
- A lost key loses every value stored under it (HR-05). Rotation adds a key
  version, re-encrypts, then drops the old one; a new HMAC key needs every
  blind index recomputed.
- Later personal-data columns (date of birth, address, guardian contact, PAN)
  reuse `encryptedText()`, the cipher and, when they must be searched, a blind
  index with their own purpose.
