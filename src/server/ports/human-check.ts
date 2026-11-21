// The human check on public forms (#113, #55 F14): a challenge the form
// gets when it opens, and a proof it sends back with the form. Use cases
// see only this port. The default adapter is FOA's own proof of work
// (src/server/modules/public-forms/proof-of-work-check.ts): no third-party
// script, no cookie, no new secret, nothing added to the CSP. A Cloudflare
// Turnstile adapter would sit behind the same port (HR-53).
//
// Loads under plain Node: relative imports only, no "server-only".

import type { AppDb } from "../db/app-db";

/** What the form island receives: enough to solve, and a signed token. */
export type HumanCheckChallenge = {
  /** Sent back unchanged with the proof. */
  token: string;
  salt: string;
  /** Leading zero bits the proof's hash needs. */
  difficulty: number;
  /** After this, the proof is refused and the form asks for a new one. */
  expiresAt: Date;
};

/** What the form sends back. */
export type HumanCheckProof = { token: string; nonce: number };

export type HumanCheckOutcome =
  /** `issuedAt` is when the challenge was issued: the form opened then. */
  | { ok: true; issuedAt: Date }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

export interface HumanCheck {
  challenge(now: Date): Promise<HumanCheckChallenge>;
  /**
   * Checks `proof` and spends it, in `tx`, so it works once: roll `tx`
   * back and the proof may be sent again.
   */
  redeem(
    tx: AppDb,
    proof: HumanCheckProof,
    now: Date
  ): Promise<HumanCheckOutcome>;
}
