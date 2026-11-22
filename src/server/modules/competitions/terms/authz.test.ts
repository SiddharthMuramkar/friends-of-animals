import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { createHarness, type Harness } from "@/test/harness";

import {
  publishDocument,
  seedCompetition,
  signInManager,
  signInWith,
  termsRowCounts,
} from "./testing";

/** Every terms use case, run by `actor` against one competition. */
function useCases(h: Harness, actor: Actor, competitionId: string) {
  const as = h.as(actor);
  return {
    getCompetitionTermsForEdit: () =>
      as.getCompetitionTermsForEdit({ competitionId }),
    setCompetitionFees: () =>
      as.setCompetitionFees({ competitionId, free: true }),
    setRoundAwards: () =>
      as.setRoundAwards({
        competitionId,
        roundKey: "foa_final",
        scheme: "medals_gsb",
      }),
    attachConsentDocument: () =>
      as.attachConsentDocument({ competitionId, purpose: "privacy_notice" }),
    detachConsentDocument: () =>
      as.detachConsentDocument({ competitionId, purpose: "privacy_notice" }),
  };
}

type Who = (h: Harness, competitionId: string) => Promise<Actor>;

const allowed: [string, Who][] = [
  ["a global competition manager", (h) => signInManager(h)],
  [
    "a competition manager for this competition",
    (h, id) => signInManager(h, { type: "competition", id }),
  ],
];

const refused: [string, Who][] = [
  [
    "a competition manager for another competition",
    async (h) => {
      const other = await seedCompetition(h);
      return signInManager(h, { type: "competition", id: other.id });
    },
  ],
  ["a content manager", (h) => signInWith(h, "content_manager")],
  ["a member", (h) => signInWith(h, null)],
  ["a visitor", async (h) => h.visitor()],
];

describe("who may change a competition's terms", () => {
  it.each(allowed)("%s may run every terms use case", async (_who, who) => {
    const h = await createHarness();
    const { id } = await seedCompetition(h, { participation: "both" });
    await publishDocument(h, "privacy_notice");
    const actor = await who(h, id);

    for (const [name, run] of Object.entries(useCases(h, actor, id))) {
      expect(await run(), name).toMatchObject({ ok: true });
    }
  });

  it.each(refused)(
    "%s is refused every terms use case, and nothing is written",
    async (_who, who) => {
      const h = await createHarness();
      const { id } = await seedCompetition(h, { participation: "both" });
      await publishDocument(h, "privacy_notice");
      const actor = await who(h, id);
      const before = await termsRowCounts(h);

      for (const [name, run] of Object.entries(useCases(h, actor, id))) {
        await expect(run(), name).rejects.toMatchObject({ code: "forbidden" });
      }
      expect(await termsRowCounts(h)).toEqual(before);
    }
  );
});

describe("a fresh second factor", () => {
  it("is needed to set fees, which are money, and refusing writes nothing", async () => {
    const h = await createHarness();
    const { id } = await seedCompetition(h, { participation: "both" });
    // Signing in passes the manager's second factor (the harness).
    const manager = await signInManager(h);
    const setFees = () =>
      h.as(manager).setCompetitionFees({
        competitionId: id,
        fees: { individual: "100", institution: "1,000" },
        currency: "INR",
      });

    h.clock.advance({ minutes: 10, seconds: 1 });
    const before = await termsRowCounts(h);
    await expect(setFees()).rejects.toMatchObject({
      name: "DomainError",
      code: "step_up_required",
    });
    expect(await termsRowCounts(h)).toEqual(before);

    await h.passSecondFactor(manager);
    expect(await setFees()).toEqual({ ok: true, changed: true });
  });

  it("is not needed for awards, documents or reading the terms", async () => {
    const h = await createHarness();
    const { id } = await seedCompetition(h, { participation: "both" });
    await publishDocument(h, "privacy_notice");
    const manager = await signInManager(h);

    h.clock.advance({ minutes: 10, seconds: 1 });
    const { setCompetitionFees: _money, ...others } = useCases(h, manager, id);
    for (const [name, run] of Object.entries(others)) {
      expect(await run(), name).toMatchObject({ ok: true });
    }
  });
});
