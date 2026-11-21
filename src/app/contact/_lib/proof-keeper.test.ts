import { describe, expect, it } from "vitest";

import { solveProofOfWork } from "@/lib/proof-of-work";
import type { Actor } from "@/server/actor";
import { contactMessage } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { challengeView } from "./challenge-view";
import { afterSubmit, EMPTY } from "./form-state";
import { proofKeeper, type Proof } from "./proof-keeper";

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
