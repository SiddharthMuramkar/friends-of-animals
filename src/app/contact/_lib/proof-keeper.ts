// The contact form island's human-check proof (#113): fetched when the
// visitor first reaches the form, solved in the background
// (src/lib/proof-of-work.ts) and reused until a send spends it. Kept apart
// from React, with the network and the clock passed in, so it is tested
// without a browser.
//
// The server drops a form sent within its fill time of the challenge being
// issued (the bot screen) and answers as if it worked. So the island never
// sends a proof sooner than that after its challenge arrived, however late
// it was fetched: on first focus, or at Send after a refused check, a
// failure or a proof past its lifetime. Otherwise a person's message could
// be dropped while they are told it was sent. Times are the page's own
// (performance.now()), so a wrong or changing device clock doesn't matter.

import { keepsProof, type ContactFormState } from "./form-state";

/**
 * A human-check challenge as the island receives it. Its times are lengths
 * from when it arrives (src/app/contact/_lib/challenge-view.ts).
 */
export type ChallengeView = {
  token: string;
  salt: string;
  difficulty: number;
  /** Sending sooner than this after the challenge is taken for a bot. */
  sendAfterMs: number;
  /** After this, the server refuses the proof. */
  expiresInMs: number;
};

/** What the form sends with its fields. */
export type Proof = { token: string; nonce: number };

/**
 * Added to the fill time, in case the server that checks a proof runs a
 * little behind the one that issued its challenge.
 */
export const SEND_MARGIN_MS = 500;

/** A proof this close to expiring is replaced, not sent. */
export const EXPIRY_MARGIN_MS = 60_000;

export type ProofKeeperDeps = {
  /** The issueChallengeAction Server Action. */
  fetchChallenge: () => Promise<ChallengeView>;
  /** solveProofOfWork. */
  solve: (challenge: { salt: string; difficulty: number }) => Promise<number>;
  /** The page's monotonic time in milliseconds: performance.now(). */
  now: () => number;
  /** Resolves after `ms` milliseconds. */
  sleep: (ms: number) => Promise<void>;
};

export type ProofKeeper = {
  /** Starts getting a proof ready; resolves once it is, or once that failed. */
  warm(): Promise<void>;
  /**
   * The proof to send now. Replaces a proof that failed or is about to
   * expire, then waits until its challenge is old enough to send. Rejects
   * if no challenge could be fetched.
   */
  forSend(): Promise<Proof>;
  /**
   * After a send: keeps a proof the send left unspent. Otherwise forgets it
   * and, if the form is still showing, starts the next one, so it is ready
   * when the visitor presses Send again.
   */
  afterSend(state: ContactFormState): void;
};

type Solved = Proof & {
  /** Page time from which the server takes it as a person's. */
  sendableAt: number;
  /** Page time from which it is replaced instead of sent. */
  staleAt: number;
};

export function proofKeeper(deps: ProofKeeperDeps): ProofKeeper {
  let current: Promise<Solved> | null = null;

  function start(): Promise<Solved> {
    const solving = (async () => {
      const challenge = await deps.fetchChallenge();
      const arrivedAt = deps.now();
      const nonce = await deps.solve(challenge);
      return {
        token: challenge.token,
        nonce,
        sendableAt: arrivedAt + challenge.sendAfterMs + SEND_MARGIN_MS,
        staleAt: arrivedAt + challenge.expiresInMs - EXPIRY_MARGIN_MS,
      };
    })();
    current = solving;
    // A failed fetch is forgotten, so the next focus or send tries again.
    solving.catch(() => {
      if (current === solving) current = null;
    });
    return solving;
  }

  function warm(): Promise<void> {
    return (current ?? start()).then(
      () => undefined,
      () => undefined
    );
  }

  return {
    warm,

    async forSend() {
      let solved = await (current ?? start()).catch(() => start());
      if (deps.now() >= solved.staleAt) solved = await start();
      const wait = solved.sendableAt - deps.now();
      if (wait > 0) await deps.sleep(wait);
      return { token: solved.token, nonce: solved.nonce };
    },

    afterSend(state) {
      // A proof works once: spent, refused, or maybe spent by a failure.
      if (keepsProof(state)) return;
      current = null;
      if (state.step === "form") void warm();
    },
  };
}
