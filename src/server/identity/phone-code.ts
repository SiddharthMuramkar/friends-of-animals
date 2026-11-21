// One-time sign-in codes sent by SMS. Better Auth's email-OTP plugin keeps
// email codes; it has no phone flow that works with an encrypted number,
// so FOA keeps phone codes itself, in the same `verification` table and
// with the same rules (SIGN_IN_CODE: 6 digits, 10 minutes, 5 wrong guesses):
//
//   - a row's identifier is "sms-sign-in:<phone_hash>", the phone's blind
//     index, so the table never holds the number;
//   - its value is "<code hash>:<wrong guesses>", the code as an HMAC
//     keyed with the auth secret, so the table never holds the code either
//     (a plain hash of six digits is a million guesses from the code);
//   - asking again replaces the code; checking takes the row with one
//     DELETE ... RETURNING, so two checks at once can't both use a code,
//     and puts it back with one more wrong guess if the code was wrong.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { verification } from "../db/schema";
import { uuidv7 } from "../ids";
import type { UseCaseContext } from "../use-cases";
import { SIGN_IN_CODE } from "./settings";

const MINUTE_MS = 60 * 1000;

export type PhoneCodeCheck =
  | "ok"
  | "code_invalid"
  | "code_expired"
  | "too_many_attempts";

function identifierFor(phoneHash: string): string {
  return `sms-sign-in:${phoneHash}`;
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
 * Makes a new code for the phone with blind index `phoneHash`, replacing
 * any earlier one, and returns it to be texted. Never store or log it.
 */
export async function issuePhoneCode(
  { db, clock, auth }: UseCaseContext,
  phoneHash: string
): Promise<string> {
  const identifier = identifierFor(phoneHash);
  const code = String(randomInt(10 ** SIGN_IN_CODE.length)).padStart(
    SIGN_IN_CODE.length,
    "0"
  );
  const now = clock.now();
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({
      id: uuidv7(now),
      identifier,
      value: `${codeHash(auth.secret, identifier, code)}:0`,
      expiresAt: new Date(
        now.getTime() + SIGN_IN_CODE.lifetimeMinutes * MINUTE_MS
      ),
      createdAt: now,
      updatedAt: now,
    });
  });
  return code;
}

/**
 * Checks `code` for the phone with blind index `phoneHash`. A right code
 * is used up, unless `keep` (the code was right but there is nothing to
 * sign in to yet); a wrong one counts as a guess.
 */
export async function checkPhoneCode(
  { db, clock, auth }: UseCaseContext,
  phoneHash: string,
  code: string,
  { keep = false }: { keep?: boolean } = {}
): Promise<PhoneCodeCheck> {
  const identifier = identifierFor(phoneHash);
  const taken = await db
    .delete(verification)
    .where(eq(verification.identifier, identifier))
    .returning();
  const row = taken.toSorted(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];
  if (!row) return "code_invalid";
  if (row.expiresAt < clock.now()) return "code_expired";

  const colon = row.value.lastIndexOf(":");
  const stored = row.value.slice(0, colon);
  const wrongGuesses = Number(row.value.slice(colon + 1)) || 0;
  if (wrongGuesses >= SIGN_IN_CODE.attempts) return "too_many_attempts";

  const right = sameHash(stored, codeHash(auth.secret, identifier, code));
  if (!right || keep) {
    await db.insert(verification).values({
      ...row,
      value: right ? row.value : `${stored}:${wrongGuesses + 1}`,
      updatedAt: clock.now(),
    });
  }
  return right ? "ok" : "code_invalid";
}
