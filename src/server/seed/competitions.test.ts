import { asc, count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competition,
  competitionAgeGroup,
  competitionCategory,
  competitionKeyDate,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_COMPETITION_MANAGERS } from "./competitions";
import { SEED_COMPETITION_MANAGER, SEED_SCOPES } from "./index";

async function counts(h: Harness) {
  const tables = {
    competitions: competition,
    ageGroups: competitionAgeGroup,
    categories: competitionCategory,
    keyDates: competitionKeyDate,
  };
  const result: Record<string, number | undefined> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await h.db.select({ n: count() }).from(table);
    result[name] = row?.n;
  }
  return result;
}

describe("the competitions seed", () => {
  it("publishes one competition per way of taking part, at the sample links", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const published = await h.as(h.visitor()).listPublishedCompetitions();

    expect(
      published.map(({ code, slug, participation, status }) => ({
        code,
        slug,
        participation,
        status,
      }))
    ).toEqual([
      {
        code: "SKIES26",
        slug: "kinder-skies",
        participation: "institutions",
        status: "published",
      },
      {
        code: "NEIGH27",
        slug: "neighbours-on-my-street",
        participation: "both",
        status: "published",
      },
      {
        code: "WATER27",
        slug: "a-bowl-of-water",
        participation: "individuals",
        status: "published",
      },
    ]);
  });

  it("keeps a draft, the seeded competition scope, off the public pages", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const rows = await h.db
      .select({ id: competition.id, status: competition.status })
      .from(competition)
      .orderBy(asc(competition.code));
    expect(rows).toContainEqual({
      id: SEED_SCOPES.competition.id,
      status: "draft",
    });
    expect(
      await h.as(h.visitor()).getPublishedCompetition({
        slug: "seed-drawing-competition",
      })
    ).toBeNull();
  });

  it("seeds a global competition manager who sees all four", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const manager = await h.signIn(SEED_COMPETITION_MANAGER);

    const listed = await h.as(manager).listCompetitionsForAdmin();

    expect(listed.map((c) => c.status).sort()).toEqual([
      "draft",
      "published",
      "published",
      "published",
    ]);
    expect(
      await h
        .as(manager)
        .previewCompetition({ competitionId: SEED_SCOPES.competition.id })
    ).toMatchObject({ ok: true, status: "draft", competition: null });
  });

  it("gives two global managers the seed authenticator, so each journey project passes the second factor as its own manager", async () => {
    const h = await createHarness();
    await h.seed.preview();

    expect(SEED_COMPETITION_MANAGERS.map((account) => account.email)).toEqual([
      "competition-manager@example.test",
      "competition-manager-2@example.test",
    ]);
    for (const account of SEED_COMPETITION_MANAGERS) {
      const manager = await h.signIn(account, undefined, {
        secondFactor: false,
      });
      expect(
        await h.as(manager).verifySecondFactor({ code: h.totpCode() }),
        account.email
      ).toEqual({ ok: true });
      expect(await h.as(manager).listCompetitionsForAdmin()).toHaveLength(4);
    }
  });

  it("changes nothing when it runs again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const once = await counts(h);
    const ids = await h.db.select({ id: competition.id }).from(competition);

    await h.seed.preview();

    expect(await counts(h)).toEqual(once);
    expect(await h.db.select({ id: competition.id }).from(competition)).toEqual(
      ids
    );
    expect(once).toMatchObject({ competitions: 4 });
  });
});

describe("h.seed.competition", () => {
  it("makes a complete draft that a manager could publish as it is", async () => {
    const h = await createHarness();
    const made = await h.seed.competition();
    await h.seed.preview();
    const manager = await h.signIn(SEED_COMPETITION_MANAGER);

    expect(made).toMatchObject({ status: "draft" });
    expect(
      await h.as(manager).publishCompetition({ competitionId: made.id })
    ).toMatchObject({ ok: true });
  });

  it("makes a published one when asked, with the fields given", async () => {
    const h = await createHarness();

    const made = await h.seed.competition({
      status: "published",
      name: "Wings Over the Ghats",
      code: "WINGS27",
    });

    expect(made).toEqual({
      id: expect.any(String),
      code: "WINGS27",
      slug: "wings-over-the-ghats",
      status: "published",
    });
    expect(
      await h
        .as(h.visitor())
        .getPublishedCompetition({ slug: "wings-over-the-ghats" })
    ).toMatchObject({
      name: "Wings Over the Ghats",
      publishedAt: h.clock.now(),
    });
  });

  it("gives each one its own code and slug", async () => {
    const h = await createHarness();

    const first = await h.seed.competition();
    const second = await h.seed.competition();

    expect(first.code).not.toBe(second.code);
    expect(first.slug).not.toBe(second.slug);
  });
});
