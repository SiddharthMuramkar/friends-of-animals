import { describe, expect, it } from "vitest";

import { solveProofOfWork } from "@/lib/proof-of-work";
import type { Actor } from "@/server/actor";
import { contactMessage } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { challengeView } from "./challenge-view";
import {
  afterFailure,
  afterSubmit,
  EMPTY,
  type ContactFormState,
} from "./form-state";
import {
  EXPIRY_MARGIN_MS,
  proofKeeper,
  SEND_MARGIN_MS,
  type ChallengeView,
  type Proof,
} from "./proof-keeper";

const FORM = {
  topic: "GENERAL",
  name: "Kavya Menon",
  email: "kavya@example.test",
  subject: "Helping at camp",
  message: "How can I help at the next adoption camp?",
};

/** About how long a phone takes to solve a production (16-bit) challenge. */
const SOLVE_MS = 1700;

/**
 * What the island's page gives its proof keeper, on the harness: challenges
 * from the use case (failing while `page.online` is false), solving that
 * takes SOLVE_MS, and the harness's clock and timers.
 */
function pageOn(h: Harness, actor: Actor, page: { online: boolean }) {
  return {
    async fetchChallenge() {
      if (!page.online) throw new TypeError("Failed to fetch");
      return challengeView(await h.as(actor).issueHumanCheckChallenge());
    },
    async solve(challenge: { salt: string; difficulty: number }) {
      const nonce = await solveProofOfWork(challenge);
      h.clock.advance(SOLVE_MS);
      return nonce;
    },
    now: () => h.clock.now().getTime(),
    async sleep(ms: number) {
      h.clock.advance(ms);
    },
  };
}

/** The contact form island as `actor` sees it: sends as contact-form.tsx does. */
function islandOn(h: Harness, actor: Actor) {
  const page = { online: true };
  const keeper = proofKeeper(pageOn(h, actor, page));
  return {
    page,
    keeper,
    async send() {
      let humanCheck: Proof | undefined;
      try {
        humanCheck = await keeper.forSend();
      } catch {
        // Sent without a proof, as the island does.
      }
      const result = await h
        .as(actor)
        .submitContactMessage({ ...FORM, humanCheck });
      keeper.afterSend(afterSubmit(result, EMPTY));
      return result;
    },
  };
}

describe("the island's proof, with the contact form's use case", () => {
  it("stores a message sent again at once after the human check refused it", async () => {
    const h = await createHarness();
    const island = islandOn(h, h.visitor());
    // No challenge comes through (a dropped connection), so the form goes
    // without a proof, and the visitor is asked to press Send again.
    island.page.online = false;
    expect(await island.send()).toEqual({
      ok: false,
      error: "human_check_failed",
    });

    island.page.online = true;
    const again = await island.send();

    expect(again.ok).toBe(true);
    expect(await h.db.$count(contactMessage)).toBe(1);
  });

  it("stores a message from a form left open longer than its proof lasts", async () => {
    const h = await createHarness();
    const island = islandOn(h, h.visitor());
    await island.keeper.warm();
    h.clock.advance({ hours: 2, minutes: 1 });

    const result = await island.send();

    expect(result.ok).toBe(true);
    expect(await h.db.$count(contactMessage)).toBe(1);
  });
});

const HOUR_MS = 60 * 60 * 1000;
const FILL_MS = 3000;

/** When a proof whose challenge arrived at `at` may be sent. */
const sendableFrom = (at: number) => at + FILL_MS + SEND_MARGIN_MS;

/**
 * A page for the keeper alone: its own clock, challenges that arrive at
 * once (each fetch is recorded with the time), solving that takes
 * `solveMs`, and timers that move the clock.
 */
function fakePage({ solveMs = 0 }: { solveMs?: number } = {}) {
  let now = 0;
  let failures = 0;
  const fetchedAt: number[] = [];
  const page = {
    get now() {
      return now;
    },
    fetchedAt,
    advance(ms: number) {
      now += ms;
    },
    /** The next `count` challenge requests fail. */
    failNext(count = 1) {
      failures += count;
    },
    deps: {
      async fetchChallenge(): Promise<ChallengeView> {
        fetchedAt.push(now);
        if (failures > 0) {
          failures -= 1;
          throw new TypeError("Failed to fetch");
        }
        return {
          token: `token-${fetchedAt.length}`,
          salt: "AAAAAAAAAAAAAAAAAAAAAA",
          difficulty: 0,
          sendAfterMs: FILL_MS,
          expiresInMs: 2 * HOUR_MS,
        };
      },
      async solve() {
        now += solveMs;
        return 42;
      },
      now: () => now,
      async sleep(ms: number) {
        now += ms;
      },
    },
  };
  return page;
}

const REFUSED: ContactFormState = afterSubmit(
  { ok: false, error: "human_check_failed" },
  EMPTY
);
const SENT: ContactFormState = afterSubmit(
  { ok: true, reference: "CM-27-8H3TZ0" },
  EMPTY
);
const FIX_A_FIELD: ContactFormState = afterSubmit(
  { ok: false, error: "invalid_input", fields: ["message"] },
  EMPTY
);

describe("proofKeeper", () => {
  it("holds a proof until its challenge is old enough to pass the bot screen", async () => {
    // A visitor who reaches the form and presses Send at once.
    const page = fakePage({ solveMs: SOLVE_MS });
    const keeper = proofKeeper(page.deps);

    const proof = await keeper.forSend();

    expect(proof).toEqual({ token: "token-1", nonce: 42 });
    expect(page.now).toBe(sendableFrom(0));
  });

  it("sends a proof at once when its challenge is old enough", async () => {
    const page = fakePage({ solveMs: SOLVE_MS });
    const keeper = proofKeeper(page.deps);
    await keeper.warm();
    page.advance(60_000);

    await keeper.forSend();

    expect(page.now).toBe(SOLVE_MS + 60_000);
  });

  it("keeps a proof a send left unspent, and sends it again at once", async () => {
    const page = fakePage();
    const keeper = proofKeeper(page.deps);
    await keeper.forSend();
    keeper.afterSend(FIX_A_FIELD);
    const fixedAt = page.now;

    const proof = await keeper.forSend();

    expect(proof.token).toBe("token-1");
    expect(page.fetchedAt).toEqual([0]);
    expect(page.now).toBe(fixedAt);
  });

  it("starts the next proof as soon as the human check refuses one, and holds it too", async () => {
    const page = fakePage({ solveMs: SOLVE_MS });
    const keeper = proofKeeper(page.deps);
    await keeper.warm();
    page.advance(60_000);
    await keeper.forSend();
    const refusedAt = page.now;

    keeper.afterSend(REFUSED);
    const proof = await keeper.forSend();

    expect(proof.token).toBe("token-2");
    expect(page.fetchedAt).toEqual([0, refusedAt]);
    expect(page.now).toBe(sendableFrom(refusedAt));
  });

  it("starts the next proof after a failed send, which may have spent it", async () => {
    const page = fakePage();
    const keeper = proofKeeper(page.deps);
    await keeper.forSend();

    keeper.afterSend(afterFailure(EMPTY));

    expect(page.fetchedAt).toHaveLength(2);
    expect((await keeper.forSend()).token).toBe("token-2");
  });

  it("starts nothing once the message is sent", async () => {
    const page = fakePage();
    const keeper = proofKeeper(page.deps);
    await keeper.forSend();

    keeper.afterSend(SENT);

    expect(page.fetchedAt).toEqual([0]);
  });

  it("replaces a proof about to expire, and holds the new one too", async () => {
    const page = fakePage({ solveMs: SOLVE_MS });
    const keeper = proofKeeper(page.deps);
    await keeper.warm();
    page.advance(2 * HOUR_MS - EXPIRY_MARGIN_MS - SOLVE_MS);
    const lateAt = page.now;

    const proof = await keeper.forSend();

    expect(proof.token).toBe("token-2");
    expect(page.fetchedAt).toEqual([0, lateAt]);
    expect(page.now).toBe(sendableFrom(lateAt));
  });

  it("sends a proof just short of that", async () => {
    const page = fakePage({ solveMs: SOLVE_MS });
    const keeper = proofKeeper(page.deps);
    await keeper.warm();
    page.advance(2 * HOUR_MS - EXPIRY_MARGIN_MS - SOLVE_MS - 1);

    const proof = await keeper.forSend();

    expect(proof.token).toBe("token-1");
  });

  it("asks again at Send for a challenge that didn't come on focus", async () => {
    const page = fakePage();
    const keeper = proofKeeper(page.deps);
    page.failNext();
    await keeper.warm();
    page.advance(10_000);

    const proof = await keeper.forSend();

    expect(proof.token).toBe("token-2");
    expect(page.now).toBe(sendableFrom(10_000));
  });

  it("gives up for this send when no challenge comes", async () => {
    const page = fakePage();
    const keeper = proofKeeper(page.deps);
    page.failNext(2);

    await expect(keeper.forSend()).rejects.toThrow("Failed to fetch");
    expect((await keeper.forSend()).token).toBe("token-3");
  });
});
