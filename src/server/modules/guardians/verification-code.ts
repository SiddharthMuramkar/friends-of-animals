// The one-time code that verifies a guardian (#81), sent to their own
// verified email and entered on /guardian/register. Kept like FOA's phone
// sign-in codes (src/server/identity/phone-code.ts), in Better Auth's
// `verification` table and with the sign-in rules (SIGN_IN_CODE: 6 digits,
// 10 minutes, 5 wrong guesses):
//
//   - a row's identifier is "guardian-verification:<guardian id>";
//   - its value is "<code hash>:<wrong guesses>", the code as an HMAC keyed
//     with the auth secret, so the table never holds the code;
//   - asking again replaces the code; checking takes the row with one
//     DELETE ... RETURNING, so two checks at once can't both use a code,
//     and puts it back with one more wrong guess if the code was wrong.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { verification } from "../../db/schema";
import { SIGN_IN_CODE } from "../../identity/settings";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";

const MINUTE_MS = 60 * 1000;

export type GuardianCodeCheck =
  | "ok"
  | "code_invalid"
  | "code_expired"
  | "too_many_attempts";

export function guardianVerificationIdentifier(guardianId: string): string {
  return `guardian-verification:${guardianId}`;
}

function codeHash(secret: string, identifier: string, code: string): string {
  return createHmac("sha256", secret)
    .update(`${identifier}\0${code}`)
    .digest("base64url");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Makes a new code for the guardian, replacing any earlier one, and
 * returns it to be sent with when it stops working. Never store or log it.
 */
export async function issueGuardianCode(
  { db, clock, auth }: Pick<UseCaseContext, "db" | "clock" | "auth">,
  guardianId: string
): Promise<{ code: string; expiresAt: Date }> {
  const identifier = guardianVerificationIdentifier(guardianId);
  const code = String(randomInt(10 ** SIGN_IN_CODE.length)).padStart(
    SIGN_IN_CODE.length,
    "0"
  );
  const now = clock.now();
  const expiresAt = new Date(
    now.getTime() + SIGN_IN_CODE.lifetimeMinutes * MINUTE_MS
  );
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({
      id: uuidv7(now),
      identifier,
      value: `${codeHash(auth.secret, identifier, code)}:0`,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  });
  return { code, expiresAt };
}

/**
 * Checks `code` for the guardian. A right code is used up; a wrong one
 * counts as a guess. Runs in the caller's transaction, so a right code is
 * used up only if the verification it confirms commits.
 */
export async function checkGuardianCode(
  { db, clock, auth }: Pick<UseCaseContext, "db" | "clock" | "auth">,
  guardianId: string,
  code: string
): Promise<GuardianCodeCheck> {
  const identifier = guardianVerificationIdentifier(guardianId);
  const taken = await db
    .delete(verification)
    .where(eq(verification.identifier, identifier))
    .returning();
  const row = taken.toSorted(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];
  if (!row) return "code_invalid";
  if (row.expiresAt <= clock.now()) return "code_expired";

  const colon = row.value.lastIndexOf(":");
  const stored = row.value.slice(0, colon);
  const wrongGuesses = Number(row.value.slice(colon + 1)) || 0;
  if (wrongGuesses >= SIGN_IN_CODE.attempts) {
    // Kept, so asking for a new code is the only way on.
    await db.insert(verification).values(row);
    return "too_many_attempts";
  }

  if (sameHash(stored, codeHash(auth.secret, identifier, code))) return "ok";
  await db.insert(verification).values({
    ...row,
    value: `${stored}:${wrongGuesses + 1}`,
    updatedAt: clock.now(),
  });
  return "code_invalid";
}
