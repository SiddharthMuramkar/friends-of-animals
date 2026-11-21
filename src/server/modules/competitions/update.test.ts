import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, competition } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import type { CompetitionInput } from "./fields";
import { completeFields, signInManager, signInWith } from "./testing";

async function setUp(input: CompetitionInput = completeFields()) {
  const h = await createHarness();
  const manager = await signInManager(h);
  const created = await h.as(manager).createCompetition(input);
  if (!created.ok) throw new Error(created.error);
  return { h, manager, competitionId: created.competition.id };
}

async function fieldsOf(h: Harness, competitionId: string) {
  const manager = await signInManager(h);
  const edit = await h.as(manager).getCompetitionForEdit({ competitionId });
  if (!edit.ok) throw new Error(edit.error);
  return edit.competition.fields;
}

async function updateEntries(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "competition.updated"));
}

describe("updateCompetition", () => {
  it("changes the fields given and replaces the age groups, categories and key dates whole", async () => {
    const { h, manager, competitionId } = await setUp();
    const changes = {
      name: "Neighbours on Our Street",
      theme: "A neighbour with fur or feathers.",
      participation: "individuals" as const,
      disciplines: ["drawing" as const, "essay" as const],
      ageGroups: [
        { label: "Little ones", minAge: 4, maxAge: 6 },
        { label: "Middle", minAge: 7, maxAge: 10 },
        { label: "Big ones", minAge: 11, maxAge: 14 },
      ],
      categories: [
        { discipline: "drawing" as const, ageGroup: "Little ones" },
        { discipline: "essay" as const, ageGroup: "Big ones" },
      ],
      keyDates: {
        registration_opens: "2027-02-01T09:00",
        registration_closes: "2027-03-01T17:30",
        submissions_close: "2027-03-01T17:30",
      },
    };

    expect(
      await h.as(manager).updateCompetition({ competitionId, ...changes })
    ).toEqual({ ok: true, changed: true });

    expect(await fieldsOf(h, competitionId)).toEqual(completeFields(changes));
  });

  it("keeps the slug when the name changes, so shared links still work", async () => {
    const { h, manager, competitionId } = await setUp();

    await h
      .as(manager)
      .updateCompetition({ competitionId, name: "A New Name" });

    const edit = await h.as(manager).getCompetitionForEdit({ competitionId });
    expect(edit).toMatchObject({
      ok: true,
      competition: { slug: "neighbours-on-my-street" },
    });
  });

  it("leaves the fields it isn't given as they were", async () => {
    const { h, manager, competitionId } = await setUp();

    await h
      .as(manager)
      .updateCompetition({ competitionId, duration: "90 minutes" });

    expect(await fieldsOf(h, competitionId)).toEqual(
      completeFields({ duration: "90 minutes" })
    );
  });

  it("makes every new discipline and age group a category when the categories aren't given", async () => {
    const { h, manager, competitionId } = await setUp();

    await h.as(manager).updateCompetition({
      competitionId,
      disciplines: ["craft", "drawing"],
    });

    expect((await fieldsOf(h, competitionId)).categories).toEqual([
      { discipline: "drawing", ageGroup: "Group A" },
      { discipline: "drawing", ageGroup: "Group B" },
      { discipline: "craft", ageGroup: "Group A" },
      { discipline: "craft", ageGroup: "Group B" },
    ]);
  });

  it("clears a key date or a text field given empty", async () => {
    const { h, manager, competitionId } = await setUp();

    await h.as(manager).updateCompetition({
      competitionId,
      rules: "  ",
      keyDates: { registration_opens: "2027-01-15T10:00" },
    });

    const fields = await fieldsOf(h, competitionId);
    expect(fields.rules).toBe("");
    expect(fields.keyDates).toEqual({ registration_opens: "2027-01-15T10:00" });
  });

  it("records one audit entry with only the fields that changed", async () => {
    const { h, manager, competitionId } = await setUp();

    await h.as(manager).updateCompetition({
      competitionId,
      ...completeFields({
        theme: "A changed theme.",
        keyDates: {
          ...completeFields().keyDates,
          registration_opens: "2027-01-20T10:00",
        },
      }),
    });

    expect(await updateEntries(h)).toEqual([
      expect.objectContaining({
        entityType: "competition",
        entityId: competitionId,
        actorRole: "competition_manager",
        before: {
          theme: completeFields().theme,
          keyDates: expect.objectContaining({
            registration_opens: "2027-01-15T04:30:00.000Z",
          }),
        },
        after: {
          theme: "A changed theme.",
          keyDates: expect.objectContaining({
            registration_opens: "2027-01-20T04:30:00.000Z",
          }),
        },
      }),
    ]);
  });

  it("records nothing and says so when nothing changed", async () => {
    const { h, manager, competitionId } = await setUp();

    expect(
      await h
        .as(manager)
        .updateCompetition({ competitionId, ...completeFields() })
    ).toEqual({ ok: true, changed: false });
    expect(await updateEntries(h)).toEqual([]);
  });

  it("stamps the change with the clock", async () => {
    const { h, manager, competitionId } = await setUp();
    h.clock.advance({ hours: 2 });

    await h
      .as(manager)
      .updateCompetition({ competitionId, duration: "3 hours" });

    const [row] = await h.db
      .select({ updatedAt: competition.updatedAt })
      .from(competition)
      .where(eq(competition.id, competitionId));
    expect(row?.updatedAt).toEqual(h.clock.now());
  });

  describe("refuses, changing nothing and recording nothing,", () => {
    it.each([
      [
        "a code in the wrong format",
        { code: "P27" },
        { error: "invalid_code" },
      ],
      [
        "a date that never existed",
        { keyDates: { submissions_close: "2027-13-01T10:00" } },
        { error: "invalid_date", fields: ["keyDates.submissions_close"] },
      ],
      [
        "a blank name",
        { name: "" },
        { error: "invalid_input", fields: ["name"] },
      ],
      [
        "a category for an age group that isn't there",
        {
          categories: [{ discipline: "drawing" as const, ageGroup: "Group Z" }],
        },
        { error: "invalid_input", fields: ["categories"] },
      ],
    ])("%s", async (_case, changes, refusal) => {
      const { h, manager, competitionId } = await setUp();

      expect(
        await h.as(manager).updateCompetition({ competitionId, ...changes })
      ).toEqual({ ok: false, ...refusal });
      expect(await fieldsOf(h, competitionId)).toEqual(completeFields());
      expect(await updateEntries(h)).toEqual([]);
    });

    it("another competition's code, in any case", async () => {
      const { h, manager, competitionId } = await setUp();
      await h
        .as(manager)
        .createCompetition({ code: "WATER27", name: "A Bowl of Water" });

      expect(
        await h
          .as(manager)
          .updateCompetition({ competitionId, code: "water27" })
      ).toEqual({ ok: false, error: "code_taken" });
      expect((await fieldsOf(h, competitionId)).code).toBe("NEIGH27");
    });
  });

  it("lets a draft change its code", async () => {
    const { h, manager, competitionId } = await setUp();

    expect(
      await h.as(manager).updateCompetition({ competitionId, code: "NEIGH28" })
    ).toEqual({ ok: true, changed: true });
    expect((await fieldsOf(h, competitionId)).code).toBe("NEIGH28");
  });

  it("says not found for an id that names no competition", async () => {
    const { h, manager } = await setUp();

    expect(
      await h.as(manager).updateCompetition({
        competitionId: "01938a00-0000-7000-8000-0000000000ff",
        theme: "Anything",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  describe("who may", () => {
    it("lets a manager scoped to that competition edit it", async () => {
      const { h, competitionId } = await setUp();
      const scoped = await signInManager(h, {
        type: "competition",
        id: competitionId,
      });

      expect(
        await h
          .as(scoped)
          .updateCompetition({ competitionId, duration: "1 hour" })
      ).toEqual({ ok: true, changed: true });
    });

    it.each([
      ["a manager scoped to another competition", "other"],
      ["a content manager", "content_manager"],
      ["a super admin", "super_admin"],
      ["a member", null],
      ["a visitor", "visitor"],
    ] as const)("refuses %s, changing nothing", async (_who, kind) => {
      const { h, competitionId } = await setUp();
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
        h.as(actor).updateCompetition({ competitionId, duration: "1 hour" })
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await fieldsOf(h, competitionId)).toEqual(completeFields());
      const [entries] = await h.db.select({ n: count() }).from(auditLog);
      expect(entries?.n).toBe(1);
    });
  });
});
