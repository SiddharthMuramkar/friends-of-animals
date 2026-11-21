import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, competition, competitionKeyDate } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { completeFields, signInManager, signInWith } from "./testing";

async function rowCounts(h: Harness) {
  const [competitions] = await h.db.select({ n: count() }).from(competition);
  const [entries] = await h.db.select({ n: count() }).from(auditLog);
  return { competitions: competitions?.n, auditEntries: entries?.n };
}

describe("createCompetition", () => {
  it("saves a draft that the edit form gets back field for field", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const fields = completeFields();

    const created = await h.as(manager).createCompetition(fields);

    expect(created).toEqual({
      ok: true,
      competition: {
        id: expect.any(String),
        code: "NEIGH27",
        slug: "neighbours-on-my-street",
        status: "draft",
      },
    });
    if (!created.ok) return;
    expect(
      await h
        .as(manager)
        .getCompetitionForEdit({ competitionId: created.competition.id })
    ).toEqual({
      ok: true,
      competition: {
        id: created.competition.id,
        slug: "neighbours-on-my-street",
        status: "draft",
        publishedAt: null,
        fields,
      },
    });
  });

  it("accepts a draft with only a code and a name, on the product defaults", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);

    const created = await h
      .as(manager)
      .createCompetition({ code: "KITE27", name: "  Kites and Birds " });
    if (!created.ok) throw new Error(created.error);

    const edit = await h
      .as(manager)
      .getCompetitionForEdit({ competitionId: created.competition.id });
    expect(edit).toMatchObject({
      ok: true,
      competition: {
        slug: "kites-and-birds",
        fields: {
          code: "KITE27",
          name: "Kites and Birds",
          theme: "",
          welfareMessage: "",
          rules: "",
          permittedMaterials: "",
          duration: "",
          participation: null,
          disciplines: [],
          ageGroups: [],
          categories: [],
          ageCutoffDate: "",
          digitalScope: "all_participants",
          shortlistPerCategory: 5,
          schoolPositions: 3,
          physicalArtwork: { kind: "all_shortlisted" },
          publicDisplay: false,
          auctionPermitted: false,
          keyDates: {},
        },
      },
    });
  });

  it("turns every discipline and age group into a category when none are given", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { categories: _omitted, ...fields } = completeFields();

    const created = await h.as(manager).createCompetition(fields);
    if (!created.ok) throw new Error(created.error);

    const edit = await h
      .as(manager)
      .getCompetitionForEdit({ competitionId: created.competition.id });
    expect(edit.ok && edit.competition.fields.categories).toEqual([
      { discipline: "drawing", ageGroup: "Group A" },
      { discipline: "drawing", ageGroup: "Group B" },
      { discipline: "painting", ageGroup: "Group A" },
      { discipline: "painting", ageGroup: "Group B" },
    ]);
  });

  describe("the code", () => {
    it("is trimmed and upper-cased", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);

      const created = await h
        .as(manager)
        .createCompetition({ code: " paws27 ", name: "Paws" });

      expect(created).toMatchObject({
        ok: true,
        competition: { code: "PAWS27" },
      });
    });

    it.each(["PAW7", "PAWSOME27", "PAWS2027", "PA WS27", ""])(
      "refuses %j, writing nothing",
      async (code) => {
        const h = await createHarness();
        const manager = await signInManager(h);

        expect(
          await h.as(manager).createCompetition({ code, name: "Paws" })
        ).toEqual({ ok: false, error: "invalid_code" });
        expect(await rowCounts(h)).toEqual({
          competitions: 0,
          auditEntries: 0,
        });
      }
    );

    it("is unique in any case, writing nothing for the second", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      await h.as(manager).createCompetition({ code: "PAWS27", name: "Paws" });

      expect(
        await h
          .as(manager)
          .createCompetition({ code: "paws27", name: "Other paws" })
      ).toEqual({ ok: false, error: "code_taken" });
      expect(await rowCounts(h)).toEqual({ competitions: 1, auditEntries: 1 });
    });

    it("is unique in the database too", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const created = await h
        .as(manager)
        .createCompetition({ code: "PAWS27", name: "Paws" });
      if (!created.ok) throw new Error(created.error);
      const [row] = await h.db
        .select()
        .from(competition)
        .where(eq(competition.id, created.competition.id));

      await expect(
        h.db.insert(competition).values({
          ...row!,
          id: "01938a00-0000-7000-8000-0000000000aa",
          slug: "another-slug",
        })
      ).rejects.toThrow();
    });
  });

  it("keeps the slug unique by adding the code to a name already in use", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    await h.as(manager).createCompetition({ code: "PAWS27", name: "Paws" });

    expect(
      await h.as(manager).createCompetition({ code: "PAWS28", name: "Paws" })
    ).toMatchObject({ ok: true, competition: { slug: "paws-paws28" } });
  });

  describe("key dates", () => {
    it("are read as IST, stored as the exact instant and shown back in IST", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);

      const created = await h.as(manager).createCompetition({
        code: "PAWS27",
        name: "Paws",
        keyDates: { registration_opens: "2027-01-15T10:00" },
      });
      if (!created.ok) throw new Error(created.error);

      const [row] = await h.db
        .select({ at: competitionKeyDate.at })
        .from(competitionKeyDate)
        .where(eq(competitionKeyDate.competitionId, created.competition.id));
      expect(row?.at.toISOString()).toBe("2027-01-15T04:30:00.000Z");
      const edit = await h
        .as(manager)
        .getCompetitionForEdit({ competitionId: created.competition.id });
      expect(edit.ok && edit.competition.fields.keyDates).toEqual({
        registration_opens: "2027-01-15T10:00",
      });
    });

    it("refuse a local time that never existed, writing nothing", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);

      expect(
        await h.as(manager).createCompetition({
          code: "PAWS27",
          name: "Paws",
          keyDates: {
            registration_opens: "2027-02-30T10:00",
            registration_closes: "2027-03-01T10:00",
          },
        })
      ).toEqual({
        ok: false,
        error: "invalid_date",
        fields: ["keyDates.registration_opens"],
      });
      expect(await rowCounts(h)).toEqual({ competitions: 0, auditEntries: 0 });
    });

    it("treat an empty value as not set", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);

      const created = await h.as(manager).createCompetition({
        code: "PAWS27",
        name: "Paws",
        keyDates: { registration_opens: "", registration_closes: "" },
      });
      if (!created.ok) throw new Error(created.error);

      const edit = await h
        .as(manager)
        .getCompetitionForEdit({ competitionId: created.competition.id });
      expect(edit.ok && edit.competition.fields.keyDates).toEqual({});
    });
  });

  it("refuses an age cut-off date that isn't a calendar date", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);

    expect(
      await h.as(manager).createCompetition({
        code: "PAWS27",
        name: "Paws",
        ageCutoffDate: "2027-02-29",
      })
    ).toEqual({ ok: false, error: "invalid_date", fields: ["ageCutoffDate"] });
  });

  it.each([
    ["a blank name", { name: "   " }, ["name"]],
    [
      "two age groups with one label",
      {
        ageGroups: [
          { label: "Juniors", minAge: 5, maxAge: 8 },
          { label: "juniors ", minAge: 9, maxAge: 12 },
        ],
      },
      ["ageGroups"],
    ],
    [
      "a category for an age group that isn't there",
      {
        disciplines: ["drawing" as const],
        ageGroups: [{ label: "Juniors", minAge: 5, maxAge: 8 }],
        categories: [{ discipline: "drawing" as const, ageGroup: "Seniors" }],
      },
      ["categories"],
    ],
    [
      "a category for a discipline the competition doesn't run",
      {
        disciplines: ["drawing" as const],
        ageGroups: [{ label: "Juniors", minAge: 5, maxAge: 8 }],
        categories: [{ discipline: "essay" as const, ageGroup: "Juniors" }],
      },
      ["categories"],
    ],
  ])("refuses %s, naming the field", async (_case, overrides, fields) => {
    const h = await createHarness();
    const manager = await signInManager(h);

    expect(
      await h
        .as(manager)
        .createCompetition({ code: "PAWS27", name: "Paws", ...overrides })
    ).toEqual({ ok: false, error: "invalid_input", fields });
    expect(await rowCounts(h)).toEqual({ competitions: 0, auditEntries: 0 });
  });

  it("records one audit entry with who created it and what they set", async () => {
    const h = await createHarness();
    const manager = await signInManager(h, undefined, {
      ip: "198.51.100.30",
      userAgent: "Manager browser",
    });
    const created = await h
      .as(manager)
      .createCompetition({ code: "PAWS27", name: "Paws", duration: "1 hour" });
    if (!created.ok) throw new Error(created.error);

    const entries = await h.db.select().from(auditLog);
    expect(entries).toEqual([
      expect.objectContaining({
        action: "competition.created",
        entityType: "competition",
        entityId: created.competition.id,
        actorKind: "user",
        actorUserId: manager.kind === "user" ? manager.userId : null,
        actorRole: "competition_manager",
        ip: "198.51.100.30",
        userAgent: "Manager browser",
        before: null,
        after: expect.objectContaining({
          code: "PAWS27",
          name: "Paws",
          duration: "1 hour",
          slug: "paws",
          status: "draft",
        }),
      }),
    ]);
  });

  describe("who may", () => {
    it("lets a global competition manager create", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);

      expect(
        await h.as(manager).createCompetition({ code: "PAWS27", name: "Paws" })
      ).toMatchObject({ ok: true });
    });

    it.each([
      ["a competition manager for one competition", "scoped"],
      ["a content manager", "content_manager"],
      ["a super admin", "super_admin"],
      ["a staff admin", "staff_admin"],
      ["a member", null],
      ["a visitor", "visitor"],
    ] as const)("refuses %s, writing nothing", async (_who, kind) => {
      const h = await createHarness();
      const actor =
        kind === "visitor"
          ? h.visitor()
          : kind === "scoped"
            ? await signInManager(h, {
                type: "competition",
                id: "01938a00-0000-7000-8000-000000002001",
              })
            : await signInWith(h, kind);

      await expect(
        h.as(actor).createCompetition({ code: "PAWS27", name: "Paws" })
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await rowCounts(h)).toEqual({ competitions: 0, auditEntries: 0 });
    });
  });
});

describe("getCompetitionForEdit", () => {
  async function created(h: Harness) {
    const manager = await signInManager(h);
    const result = await h
      .as(manager)
      .createCompetition({ code: "PAWS27", name: "Paws" });
    if (!result.ok) throw new Error(result.error);
    return result.competition.id;
  }

  it("lets a manager scoped to that competition open it", async () => {
    const h = await createHarness();
    const competitionId = await created(h);
    const scoped = await signInManager(h, {
      type: "competition",
      id: competitionId,
    });

    expect(
      await h.as(scoped).getCompetitionForEdit({ competitionId })
    ).toMatchObject({ ok: true, competition: { id: competitionId } });
  });

  it("says not found for an id that names no competition", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);

    expect(
      await h.as(manager).getCompetitionForEdit({
        competitionId: "01938a00-0000-7000-8000-0000000000ff",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(manager).getCompetitionForEdit({ competitionId: "nope" })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    ["a manager scoped to another competition", "other"],
    ["a content manager", "content_manager"],
    ["a member", null],
    ["a visitor", "visitor"],
  ] as const)("refuses %s", async (_who, kind) => {
    const h = await createHarness();
    const competitionId = await created(h);
    const actor =
      kind === "visitor"
        ? h.visitor()
        : kind === "other"
          ? await signInManager(h, {
              type: "competition",
              id: "01938a00-0000-7000-8000-000000002001",
            })
          : await signInWith(h, kind);

    await expect(
      h.as(actor).getCompetitionForEdit({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
