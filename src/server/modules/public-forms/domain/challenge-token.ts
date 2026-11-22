// Stateless human-check challenges (#113). Issuing one writes nothing: the
// salt, the time it was issued and the difficulty travel to the browser
// in a token the server signs, so a flood of page views can't fill a
// table. Spending one inserts its hash once (the adapter's job), which
// makes each proof single-use. The signed issue time also tells the bot
// screen how long the form took to fill, without trusting the browser.
//
// Loads under plain Node, so no "server-only" here.

import { timingSafeEqual } from "node:crypto";

import { MAX_DIFFICULTY } from "../../../../lib/proof-of-work";

/** A keyed MAC over `data`, base64url; the adapter supplies the key. */
export type ChallengeMac = (data: string) => string;

export type Challenge = { salt: string; issuedAt: Date; difficulty: number };

const VERSION = "v1";

/** 16 random bytes, base64url without padding. */
const SALT = /^[A-Za-z0-9_-]{22}$/;
const MILLISECONDS = /^\d{1,15}$/;
const DIFFICULTY = /^\d{1,2}$/;

function isValidDifficulty(difficulty: number): boolean {
  return (
    Number.isInteger(difficulty) &&
    difficulty >= 0 &&
    difficulty <= MAX_DIFFICULTY
  );
}

function payload(challenge: Challenge): string {
  return [
    VERSION,
    challenge.salt,
    String(challenge.issuedAt.getTime()),
    String(challenge.difficulty),
  ].join(".");
}

/** The token the form island sends back with its proof. */
export function encodeChallengeToken(
  challenge: Challenge,
  mac: ChallengeMac
): string {
  if (!SALT.test(challenge.salt) || !isValidDifficulty(challenge.difficulty)) {
    throw new RangeError(
      "A challenge needs a 16-byte base64url salt and a valid difficulty"
    );
  }
  const data = payload(challenge);
  return `${data}.${mac(data)}`;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The challenge in `token`, or null if it is malformed or not ours. */
export function decodeChallengeToken(
  token: string,
  mac: ChallengeMac
): Challenge | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, salt, issuedAt, difficulty, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (
    version !== VERSION ||
    !SALT.test(salt) ||
    !MILLISECONDS.test(issuedAt) ||
    !DIFFICULTY.test(difficulty)
  ) {
    return null;
  }
  const challenge = {
    salt,
    issuedAt: new Date(Number(issuedAt)),
    difficulty: Number(difficulty),
  };
  if (!isValidDifficulty(challenge.difficulty)) return null;
  if (!sameText(signature, mac(payload(challenge)))) return null;
  return challenge;
}

/** How long a challenge stays usable: time to write a long message. */
export const CHALLENGE_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Whether `challenge` may still be spent at `now`. */
export function challengeAge(
  challenge: Challenge,
  now: Date,
  lifetimeMs: number = CHALLENGE_LIFETIME_MS
): "fresh" | "expired" {
  const age = now.getTime() - challenge.issuedAt.getTime();
  return age >= 0 && age <= lifetimeMs ? "fresh" : "expired";
}
