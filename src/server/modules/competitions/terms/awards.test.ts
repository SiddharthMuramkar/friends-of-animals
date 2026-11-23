import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { competitionAwardScheme } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  competitionAudit,
  seedCompetition,
  signInManager,
  termsRowCounts,
} from "./testing";

async function awardRows(h: Harness, competitionId: string) {
  return h.db
    .select({
      round: competitionAwardScheme.round,
      scheme: competitionAwardScheme.scheme,
      prizes: competitionAwardScheme.prizes,
    })
    .from(competitionAwardScheme)
    .where(eq(competitionAwardScheme.competitionId, competitionId))
    .orderBy(competitionAwardScheme.round);
}

const ranked = (prizes: Partial<Record<string, string>> = {}) => ({
  scheme: "ranked_123",
  bands: ["first", "second", "third"].map((band) => ({
    band,
    prize: prizes[band] ?? null,
  })),
});

describe("award schemes", () => {
  it("default to ranked 1st, 2nd and 3rd for every round the competition runs", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const both = await seedCompetition(h, { participation: "both" });
    const individuals = await seedCompetition(h, {
      participation: "individuals",
    });

    const forBoth = await h
      .as(manager)
      .getCompetitionTermsForEdit({ competitionId: both.id });
    const forIndividuals = await h
      .as(manager)
      .getCompetitionTermsForEdit({ competitionId: individuals.id });

    expect(forBoth.ok && forBoth.terms.awards).toEqual([
      { roundKey: "school", ...ranked() },
      { roundKey: "foa_final", ...ranked() },
    ]);
    expect(forIndividuals.ok && forIndividuals.terms.awards).toEqual([
      { roundKey: "foa_final", ...ranked() },
    ]);
    expect(await awardRows(h, both.id)).toEqual([]);
  });
});

describe("setRoundAwards", () => {
  it("stores one round's scheme and prizes and leaves the FOA final alone", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, { participation: "both" });

    expect(
      await h.as(manager).setRoundAwards({
        competitionId: id,
        roundKey: "school",
        scheme: "grades_ab",
        prizes: { grade_a: " Trophy ", grade_b: "" },
      })
    ).toEqual({ ok: true, changed: true });

    expect(await awardRows(h, id)).toEqual([
      { round: "school", scheme: "grades_ab", prizes: { grade_a: "Trophy" } },
    ]);
    const edit = await h
      .as(manager)
      .getCompetitionTermsForEdit({ competitionId: id });
    expect(edit.ok && edit.terms.awards).toEqual([
      {
        roundKey: "school",
        scheme: "grades_ab",
        bands: [
          { band: "grade_a", prize: "Trophy" },
          { band: "grade_b", prize: null },
        ],
      },
      { roundKey: "foa_final", ...ranked() },
    ]);
  });

  it("keeps only the new scheme's prizes when the scheme changes", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, { participation: "individuals" });
    await h.as(manager).setRoundAwards({
      competitionId: id,
      roundKey: "foa_final",
      scheme: "ranked_123",
      prizes: { first: "Trophy", second: "Books" },
    });

    await h.as(manager).setRoundAwards({
      competitionId: id,
      roundKey: "foa_final",
      scheme: "medals_gsb",
      prizes: { gold: "Gold medal" },
    });

    expect(await awardRows(h, id)).toEqual([
      {
        round: "foa_final",
        scheme: "medals_gsb",
        prizes: { gold: "Gold medal" },
      },
    ]);
  });

  describe("refuses, writing nothing", () => {
    it.each([
      [
        "a prize for a band the scheme doesn't have",
        "both",
        { roundKey: "school", scheme: "grades_ab", prizes: { gold: "Cup" } },
        "band_not_in_scheme",
      ],
      [
        "a school round when no institution takes part",
        "individuals",
        { roundKey: "school", scheme: "ranked_123", prizes: {} },
        "round_not_offered",
      ],
      [
        "an unknown scheme",
        "both",
        { roundKey: "foa_final", scheme: "stars_5", prizes: {} },
        "unknown_scheme",
      ],
      [
        "a prize over 200 characters",
        "both",
        {
          roundKey: "foa_final",
          scheme: "ranked_123",
          prizes: { first: "a".repeat(201) },
        },
        "prize_too_long",
      ],
    ] as const)("%s", async (_name, participation, awards, error) => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h, { participation });
      const before = await termsRowCounts(h);

      expect(
        await h.as(manager).setRoundAwards({ competitionId: id, ...awards })
      ).toEqual({ ok: false, error });
      expect(await termsRowCounts(h)).toEqual(before);
    });
  });

  it("stays open after publishing: prizes are copy, not money", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, {
      participation: "individuals",
      status: "published",
    });

    expect(
      await h.as(manager).setRoundAwards({
        competitionId: id,
        roundKey: "foa_final",
        scheme: "medals_gsb",
      })
    ).toEqual({ ok: true, changed: true });
  });

  describe("the audit log", () => {
    it("records each change once, naming the round and the changed fields", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h, { participation: "both" });

      await h.as(manager).setRoundAwards({
        competitionId: id,
        roundKey: "school",
        scheme: "grades_ab",
        prizes: { grade_a: "Trophy" },
      });
      await h.as(manager).setRoundAwards({
        competitionId: id,
        roundKey: "school",
        scheme: "grades_ab",
        prizes: { grade_a: "Trophy and books" },
      });

      expect(await competitionAudit(h, id)).toEqual([
        {
          action: "competition.awards_set",
          actorRole: "competition_manager",
          before: { round: "school", scheme: "ranked_123", prizes: {} },
          after: {
            round: "school",
            scheme: "grades_ab",
            prizes: { grade_a: "Trophy" },
          },
        },
        {
          action: "competition.awards_set",
          actorRole: "competition_manager",
          before: { round: "school", prizes: { grade_a: "Trophy" } },
          after: { round: "school", prizes: { grade_a: "Trophy and books" } },
        },
      ]);
    });

    it("records nothing, and stores nothing, for what is already there", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h, { participation: "both" });

      expect(
        await h.as(manager).setRoundAwards({
          competitionId: id,
          roundKey: "foa_final",
          scheme: "ranked_123",
          prizes: { first: "  " },
        })
      ).toEqual({ ok: true, changed: false });
      expect(await competitionAudit(h, id)).toEqual([]);
      expect(await awardRows(h, id)).toEqual([]);
    });
  });
});
