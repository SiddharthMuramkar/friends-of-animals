// What the contact form island receives for a human-check challenge, from
// what the use case issues. Its times are lengths from when the island gets
// it, so the island never compares its clock with the server's. Server-side
// only: the island imports nothing from here but types.

import { MIN_FILL_MS } from "@/server/modules/contact/domain/submission";
import type { HumanCheckChallenge } from "@/server/modules/public-forms";

import type { ChallengeView } from "./proof-keeper";

export function challengeView(challenge: HumanCheckChallenge): ChallengeView {
  return {
    token: challenge.token,
    salt: challenge.salt,
    difficulty: challenge.difficulty,
    // The bot screen drops a form sent within this of the challenge.
    sendAfterMs: MIN_FILL_MS,
    expiresInMs: challenge.expiresAt.getTime() - challenge.issuedAt.getTime(),
  };
}
