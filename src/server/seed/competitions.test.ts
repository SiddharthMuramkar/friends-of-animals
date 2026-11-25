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
  it("publishes the sample competitions for every way of taking part and the entry examples", async () => {
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
        code: "ORIG27",
        slug: "originals-for-animals",
        participation: "both",
        status: "foa_judging",
      },
      {
        code: "JURY27",
        slug: "kindness-in-art",
        participation: "individuals",
        status: "foa_judging",
      },
      {
        code: "AUCT27",
        slug: "art-for-kindness",
        participation: "individuals",
        status: "results_published",
      },
      {
        code: "RSLT27",
        slug: "kindness-in-words",
        participation: "individuals",
        status: "foa_judging",
      },
      {
        code: "CHECK27",
        slug: "stories-for-animals",
        participation: "individuals",
        status: "foa_judging",
      },
      {
        code: "SKIES26",
        slug: "kinder-skies",
        participation: "institutions",
        status: "school_judging",
      },
      // The school-route submissions seed's (#87).
      {
        code: "TREES27",
        slug: "trees-for-birds",
        participation: "institutions",
        status: "registration_closed",
      },
      // Cancelled after it was published (#80): still listed, as cancelled.
      {
        code: "WINGS26",
        slug: "wings-at-dusk",
        participation: "institutions",
        status: "cancelled",
      },
      {
        code: "NEIGH27",
        slug: "neighbours-on-my-street",
        participation: "both",
        status: "registration_open",
      },
      {
        code: "ROOF27",
        slug: "life-on-the-rooftops",
        participation: "individuals",
        status: "registration_closed",
      },
      {
        code: "BIRDS27",
        slug: "birds-in-our-gardens",
        participation: "individuals",
        status: "registration_closed",
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

  it("seeds a global competition manager who sees all thirteen", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const manager = await h.signIn(SEED_COMPETITION_MANAGER);

    const listed = await h.as(manager).listCompetitionsForAdmin();

    expect(listed.map((c) => c.status).sort()).toEqual([
      "cancelled",
      "draft",
      "foa_judging",
      "foa_judging",
      "foa_judging",
      "foa_judging",
      "published",
      "registration_closed",
      "registration_closed",
      "registration_closed",
      "registration_open",
      "results_published",
      "school_judging",
    ]);
    expect(
      await h
        .as(manager)
        .previewCompetition({ competitionId: SEED_SCOPES.competition.id })
    ).toMatchObject({ ok: true, status: "draft", competition: null });
  });

  it.each(["2026-09-01", "2027-01-15", "2028-04-01"])(
    "sets key dates that agree with the stored statuses on %s",
    async (day) => {
      const now = new Date(`${day}T04:30:00.000Z`);
      const h = await createHarness({ now });
      await h.seed.preview();
      const reader = h.as(h.visitor());
      const seeded = await reader.listPublishedCompetitions();

      expect(
        seeded.map(({ status, keyDates }) => ({
          status,
          openingPassed: keyDates[0]!.at <= now,
          closingPassed: keyDates[1]!.at <= now,
          submissionsClosed: keyDates[2]!.at <= now,
        }))
      ).toEqual([
        {
          status: "foa_judging",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: true,
        },
        {
          status: "foa_judging",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: true,
        },
        {
          status: "results_published",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: true,
        },
        {
          status: "foa_judging",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: true,
        },
        {
          status: "foa_judging",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: true,
        },
        {
          status: "school_judging",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: true,
        },
        // Open for the school's submissions (#87).
        {
          status: "registration_closed",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: false,
        },
        // Cancelled while registration was open (#80): its dates stay as
        // they were, and nothing moves it.
        {
          status: "cancelled",
          openingPassed: true,
          closingPassed: false,
          submissionsClosed: false,
        },
        {
          status: "registration_open",
          openingPassed: true,
          closingPassed: false,
          submissionsClosed: false,
        },
        {
          status: "registration_closed",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: false,
        },
        {
          status: "registration_closed",
          openingPassed: true,
          closingPassed: true,
          submissionsClosed: false,
        },
        {
          status: "published",
          openingPassed: false,
          closingPassed: false,
          submissionsClosed: false,
        },
      ]);

      await h.drain();
      await h.seed.preview();
      expect(await reader.listPublishedCompetitions()).toEqual(seeded);
    }
  );

  it("schedules each seeded competition's next move, so a preview's status moves on its own", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const reader = h.as(h.visitor());
    const statusOf = async (slug: string) =>
      (await reader.getPublishedCompetition({ slug }))?.status;
    const opensOf = async (slug: string, kind: string) =>
      (await reader.getPublishedCompetition({ slug }))?.keyDates.find(
        (date) => date.kind === kind
      )?.at;

    const waterOpens = await opensOf("a-bowl-of-water", "registration_opens");
    const neighbourCloses = await opensOf(
      "neighbours-on-my-street",
      "registration_closes"
    );
    if (!waterOpens || !neighbourCloses) throw new Error("dates missing");

    h.clock.set(neighbourCloses);
    await h.drain();
    expect(await statusOf("neighbours-on-my-street")).toBe(
      "registration_closed"
    );
    expect(await statusOf("a-bowl-of-water")).toBe("published");

    h.clock.set(waterOpens);
    await h.drain();
    expect(await statusOf("a-bowl-of-water")).toBe("registration_open");
    expect(await statusOf("kinder-skies")).toBe("school_judging");

    // Every one of its rubrics is published (the judging seed, #88).
    const neighbourSubmissions = await opensOf(
      "neighbours-on-my-street",
      "submissions_close"
    );
    if (!neighbourSubmissions) throw new Error("dates missing");
    h.clock.set(neighbourSubmissions);
    await h.drain();
    expect(await statusOf("neighbours-on-my-street")).toBe("school_judging");
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
      expect(await h.as(manager).listCompetitionsForAdmin()).toHaveLength(13);
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
    expect(once).toMatchObject({ competitions: 13 });
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
