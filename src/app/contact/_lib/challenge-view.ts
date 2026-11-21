// What the contact form island receives for a human-check challenge, from
// what the use case issues. Server-side only: the island imports nothing
// from here but types.

import type { HumanCheckChallenge } from "@/server/modules/public-forms";

import type { ChallengeView } from "./proof-keeper";

export function challengeView(challenge: HumanCheckChallenge): ChallengeView {
  return { ...challenge, expiresAt: challenge.expiresAt.toISOString() };
}
