// The contact form island's human-check proof (#113): fetched when the
// visitor first reaches the form, solved in the background
// (src/lib/proof-of-work.ts) and reused until a send spends it. Kept apart
// from React, with the network and the clock passed in, so it is tested
// without a browser.

import { keepsProof, type ContactFormState } from "./form-state";

/** A human-check challenge as the island receives it. */
export type ChallengeView = {
  token: string;
  salt: string;
  difficulty: number;
  /** ISO 8601. */
  expiresAt: string;
};

/** What the form sends with its fields. */
export type Proof = { token: string; nonce: number };

export type ProofKeeperDeps = {
  /** The issueChallengeAction Server Action. */
  fetchChallenge: () => Promise<ChallengeView>;
  /** solveProofOfWork. */
  solve: (challenge: { salt: string; difficulty: number }) => Promise<number>;
  /** The time, in milliseconds. */
  now: () => number;
};

export type ProofKeeper = {
  /** Starts getting a proof ready; resolves once it is, or once that failed. */
  warm(): Promise<void>;
  /** The proof to send now; rejects if no challenge could be fetched. */
  forSend(): Promise<Proof>;
  /** After a send: keeps a proof the send left unspent, or forgets it. */
  afterSend(state: ContactFormState): void;
};

type Solved = Proof & { expiresAt: number };

export function proofKeeper(deps: ProofKeeperDeps): ProofKeeper {
  let current: Promise<Solved> | null = null;

  /** The proof for the next send, started once and reused until spent. */
  function next(): Promise<Solved> {
    if (current) return current;
    const solving = (async () => {
      const challenge = await deps.fetchChallenge();
      const nonce = await deps.solve(challenge);
      return {
        token: challenge.token,
        nonce,
        expiresAt: Date.parse(challenge.expiresAt),
      };
    })();
    current = solving;
    // A failed fetch is tried again on the next focus or send.
    solving.catch(() => {
      if (current === solving) current = null;
    });
    return solving;
  }

  return {
    warm() {
      return next().then(
        () => undefined,
        () => undefined
      );
    },

    async forSend() {
      let ready = await next();
      if (ready.expiresAt <= deps.now()) {
        current = null;
        ready = await next();
      }
      return { token: ready.token, nonce: ready.nonce };
    },

    afterSend(state) {
      // A proof works once: once spent, the next send solves a new one.
      if (!keepsProof(state)) current = null;
    },
  };
}
