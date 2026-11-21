// The default human check (#113, #55 F14): proof of work, self-hosted.
// A challenge is a random salt, signed with the time it was issued and its
// difficulty, so issuing one stores nothing. Spending one stores its salt
// in the caller's transaction, so each proof works once. The browser
// solves it with src/lib/proof-of-work.ts: no third-party script, no
// cookie, nothing added to the CSP.
//
// Loads under plain Node, so no "server-only" here.

import { createHmac, randomBytes } from "node:crypto";

import { lt } from "drizzle-orm";

import { verifyProofOfWork } from "../../../lib/proof-of-work";
import { humanCheckRedemption } from "../../db/schema";
import type { HumanCheck } from "../../ports/human-check";
import {
  CHALLENGE_LIFETIME_MS,
  challengeAge,
  decodeChallengeToken,
  encodeChallengeToken,
  type ChallengeMac,
} from "./domain/challenge-token";

/**
 * Leading zero bits a proof needs in production: about 65,000 hashes, a
 * moment on a phone, solved while the visitor types (HR-51, HR-28).
 */
export const HUMAN_CHECK_DIFFICULTY = 16;

export function proofOfWorkHumanCheck(options: {
  /** Signs challenges; the app's auth secret. */
  secret: string;
  difficulty: number;
}): HumanCheck {
  const { secret, difficulty } = options;
  const mac: ChallengeMac = (data) =>
    createHmac("sha256", secret)
      .update(`human-check\0${data}`)
      .digest("base64url");

  return {
    async challenge(now) {
      const salt = randomBytes(16).toString("base64url");
      return {
        token: encodeChallengeToken({ salt, issuedAt: now, difficulty }, mac),
        salt,
        difficulty,
        expiresAt: new Date(now.getTime() + CHALLENGE_LIFETIME_MS),
      };
    },

    async redeem(tx, proof, now) {
      const challenge = decodeChallengeToken(proof.token, mac);
      if (!challenge) return { ok: false, reason: "invalid" };
      if (challengeAge(challenge, now) === "expired") {
        return { ok: false, reason: "expired" };
      }
      const solved = await verifyProofOfWork({
        salt: challenge.salt,
        difficulty: challenge.difficulty,
        nonce: proof.nonce,
      });
      if (!solved) return { ok: false, reason: "invalid" };
      const spent = await tx
        .insert(humanCheckRedemption)
        .values({ salt: challenge.salt, redeemedAt: now })
        .onConflictDoNothing()
        .returning({ salt: humanCheckRedemption.salt });
      if (spent.length === 0) return { ok: false, reason: "reused" };
      // A salt spent over a lifetime ago belongs to a challenge that has
      // expired (it was issued before it was spent), so it can go.
      await tx
        .delete(humanCheckRedemption)
        .where(
          lt(
            humanCheckRedemption.redeemedAt,
            new Date(now.getTime() - CHALLENGE_LIFETIME_MS)
          )
        );
      return { ok: true, issuedAt: challenge.issuedAt };
    },
  };
}
