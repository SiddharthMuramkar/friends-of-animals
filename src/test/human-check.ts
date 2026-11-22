// Passing the public forms' human check in a Seam 1 test, the way the form
// island does it: get a challenge, solve it, and take a few seconds to fill
// the form (the bot screen drops anything under 3). The harness issues
// easy challenges, so solving takes a few hashes.

import { solveProofOfWork } from "@/lib/proof-of-work";
import type { Actor } from "@/server/actor";

import type { Harness } from "./harness";

export async function solvedHumanCheck(
  h: Harness,
  actor: Actor,
  { fillSeconds = 5 }: { fillSeconds?: number } = {}
): Promise<{ token: string; nonce: number }> {
  const challenge = await h.as(actor).issueHumanCheckChallenge();
  const nonce = await solveProofOfWork(challenge);
  h.clock.advance({ seconds: fillSeconds });
  return { token: challenge.token, nonce };
}
