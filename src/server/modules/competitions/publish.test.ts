import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import type { CompetitionInput } from "./fields";
import { completeFields, signInManager, signInWith } from "./testing";

const OTHER_COMPETITION = "01938a00-0000-7000-8000-000000002001";

async function setUp(input: CompetitionInput = completeFields()) {
  const h = await createHarness();
  const manager = await signInManager(h);
  const created = await h.as(manager).createCompetition(input);
  if (!created.ok) throw new Error(created.error);
  return { h, manager, competitionId: created.competition.id };
}

async function entries(h: Harness, action: string) {
  return h.db.select().from(auditLog).where(eq(auditLog.action, action));
}

/** What a visitor sees for the complete fields once published at `at`. */
function publicView(id: string, publishedAt: Date) {
  return {
    id,
    code: "NEIGH27",
    slug: "neighbours-on-my-street",
    name: "Neighbours on My Street",
    theme:
      "An animal that shares your street, and one kind thing you do for it.",
    welfareMessage: "Every street animal deserves water, shade and kindness.",
    status: "published",
    participation: "both",
    disciplines: ["drawing", "painting"],
    ageGroups: [
      { label: "Group A", minAge: 5, maxAge: 8 },
      { label: "Group B", minAge: 9, maxAge: 12 },
    ],
    categories: [
      { discipline: "drawing", ageGroup: "Group A" },
      { discipline: "drawing", ageGroup: "Group B" },
      { discipline: "painting", ageGroup: "Group B" },
    ],
    ageCutoffDate: "2027-01-01",
    rules: "One original artwork per participant. No AI-generated work.",
    permittedMaterials:
      "Pencil, crayon, watercolour or poster colour on A3 paper.",
    duration: "2 hours",
    digitalScope: "shortlist_only",
    shortlistPerCategory: 6,
    schoolPositions: 3,
    physicalArtwork: { kind: "top_n", count: 4 },
    publicDisplay: true,
    auctionPermitted: false,
    keyDates: [
      {
        kind: "registration_opens",
        at: new Date("2027-01-15T04:30:00.000Z"),
      },
      {
        kind: "registration_closes",
        at: new Date("2027-02-15T18:29:00.000Z"),
      },
      { kind: "submissions_close", at: new Date("2027-02-28T18:29:00.000Z") },
      {
        kind: "school_round_closes",
        at: new Date("2027-03-10T12:30:00.000Z"),
      },
    ],
    publishedAt,
  };
}

describe("publishCompetition", () => {
  it("publishes a complete draft, stamped by the clock", async () => {
    const { h, manager, competitionId } = await setUp();
    h.clock.advance({ days: 1 });

    expect(await h.as(manager).publishCompetition({ competitionId })).toEqual({
      ok: true,
      competition: {
        id: competitionId,
        code: "NEIGH27",
        slug: "neighbours-on-my-street",
        status: "published",
        publishedAt: h.clock.now(),
      },
    });
    expect(
      await h.as(manager).getCompetitionForEdit({ competitionId })
    ).toMatchObject({
      ok: true,
      competition: { status: "published", publishedAt: h.clock.now() },
    });
  });

  it("refuses a draft missing what the public page needs, naming every gap", async () => {
    const { h, manager, competitionId } = await setUp({
      code: "PAWS27",
      name: "Paws",
      participation: "individuals",
    });

    const result = await h.as(manager).publishCompetition({ competitionId });

    expect(result).toEqual({
      ok: false,
      error: "not_ready",
      problems: [
        { field: "theme", code: "required" },
        { field: "welfareMessage", code: "required" },
        { field: "rules", code: "required" },
        { field: "permittedMaterials", code: "required" },
        { field: "duration", code: "required" },
        { field: "disciplines", code: "required" },
        { field: "ageCutoffDate", code: "required" },
        { field: "ageGroups", code: "none" },
        { field: "categories", code: "required" },
        { field: "keyDates", code: "required", kind: "registration_opens" },
        { field: "keyDates", code: "required", kind: "registration_closes" },
        { field: "keyDates", code: "required", kind: "submissions_close" },
      ],
    });
  });

  it("refuses dates out of order and overlapping age groups, changing nothing", async () => {
    const { h, manager, competitionId } = await setUp(
      completeFields({
        ageGroups: [
          { label: "Group A", minAge: 5, maxAge: 9 },
          { label: "Group B", minAge: 9, maxAge: 12 },
        ],
        keyDates: {
          ...completeFields().keyDates,
          registration_closes: "2027-01-15T10:00",
        },
      })
    );

    expect(await h.as(manager).publishCompetition({ competitionId })).toEqual({
      ok: false,
      error: "not_ready",
      problems: [
        { field: "ageGroups", code: "overlaps", index: 1, other: 0 },
        {
          field: "keyDates",
          code: "must_follow",
          kind: "registration_closes",
          other: "registration_opens",
        },
      ],
    });
    expect(
      await h.as(manager).getCompetitionForEdit({ competitionId })
    ).toMatchObject({ competition: { status: "draft", publishedAt: null } });
    expect(await entries(h, "competition.published")).toEqual([]);
  });

  it("refuses to publish twice", async () => {
    const { h, manager, competitionId } = await setUp();
    await h.as(manager).publishCompetition({ competitionId });

    expect(await h.as(manager).publishCompetition({ competitionId })).toEqual({
      ok: false,
      error: "not_draft",
    });
    expect(await entries(h, "competition.published")).toHaveLength(1);
  });

  it("says not found for an id that names no competition", async () => {
    const { h, manager } = await setUp();

    expect(
      await h.as(manager).publishCompetition({
        competitionId: "01938a00-0000-7000-8000-0000000000ff",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("records one audit entry for the status change", async () => {
    const { h, manager, competitionId } = await setUp();

    await h.as(manager).publishCompetition({ competitionId });

    expect(await entries(h, "competition.published")).toEqual([
      expect.objectContaining({
        entityType: "competition",
        entityId: competitionId,
        actorRole: "competition_manager",
        before: { status: "draft", publishedAt: null },
        after: {
          status: "published",
          publishedAt: h.clock.now().toISOString(),
        },
      }),
    ]);
  });

  describe("who may", () => {
    it("lets a manager scoped to that competition publish it", async () => {
      const { h, competitionId } = await setUp();
      const scoped = await signInManager(h, {
        type: "competition",
        id: competitionId,
      });

      expect(
        await h.as(scoped).publishCompetition({ competitionId })
      ).toMatchObject({ ok: true });
    });

    it.each([
      ["a manager scoped to another competition", "other"],
      ["a content manager", "content_manager"],
      ["a super admin", "super_admin"],
      ["a member", null],
      ["a visitor", "visitor"],
    ] as const)("refuses %s, changing nothing", async (_who, kind) => {
      const { h, manager, competitionId } = await setUp();
      const actor =
        kind === "visitor"
          ? h.visitor()
          : kind === "other"
            ? await signInManager(h, {
                type: "competition",
                id: OTHER_COMPETITION,
              })
            : await signInWith(h, kind);

      await expect(
        h.as(actor).publishCompetition({ competitionId })
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        await h.as(manager).getCompetitionForEdit({ competitionId })
      ).toMatchObject({ competition: { status: "draft" } });
      expect(await entries(h, "competition.published")).toEqual([]);
    });
  });
});

describe("editing a published competition", () => {
  async function published() {
    const set = await setUp();
    await set.h
      .as(set.manager)
      .publishCompetition({ competitionId: set.competitionId });
    return set;
  }

  it("saves a change that keeps it complete, and it stays published", async () => {
    const { h, manager, competitionId } = await published();

    expect(
      await h
        .as(manager)
        .updateCompetition({ competitionId, duration: "3 hours" })
    ).toEqual({ ok: true, changed: true });
    expect(
      await h.as(manager).getCompetitionForEdit({ competitionId })
    ).toMatchObject({
      competition: { status: "published", fields: { duration: "3 hours" } },
    });
  });

  it("refuses a change that would leave the public page with a gap", async () => {
    const { h, manager, competitionId } = await published();

    expect(
      await h.as(manager).updateCompetition({ competitionId, rules: "" })
    ).toEqual({
      ok: false,
      error: "not_ready",
      problems: [{ field: "rules", code: "required" }],
    });
    expect(
      await h.as(manager).getCompetitionForEdit({ competitionId })
    ).toMatchObject({
      competition: { fields: { rules: completeFields().rules } },
    });
  });

  it("refuses a new code: registration numbers are made from it", async () => {
    const { h, manager, competitionId } = await published();

    expect(
      await h.as(manager).updateCompetition({ competitionId, code: "NEIGH28" })
    ).toEqual({ ok: false, error: "code_locked" });
  });
});

describe("the public read model", () => {
  it("never shows a draft, and shows the competition once published", async () => {
    const { h, manager, competitionId } = await setUp();
    const visitor = h.visitor();
    const slug = "neighbours-on-my-street";

    expect(await h.as(visitor).listPublishedCompetitions()).toEqual([]);
    expect(await h.as(visitor).getPublishedCompetition({ slug })).toBeNull();
    expect(await h.as(visitor).publishedCompetitionSlugs()).toEqual([]);

    await h.as(manager).publishCompetition({ competitionId });

    const view = publicView(competitionId, h.clock.now());
    expect(await h.as(visitor).listPublishedCompetitions()).toEqual([view]);
    expect(await h.as(visitor).getPublishedCompetition({ slug })).toEqual(view);
    expect(await h.as(visitor).publishedCompetitionSlugs()).toEqual([slug]);
  });

  it("lists published competitions by when registration opens, beside drafts it leaves out", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const later = await h.as(manager).createCompetition(
      completeFields({
        code: "WATER27",
        name: "A Bowl of Water",
        keyDates: {
          registration_opens: "2027-02-01T09:00",
          registration_closes: "2027-03-31T23:59",
          submissions_close: "2027-04-25T23:59",
          school_round_closes: "2027-05-05T23:59",
        },
      })
    );
    const sooner = await h.as(manager).createCompetition(completeFields());
    await h
      .as(manager)
      .createCompetition(completeFields({ code: "DRAFT27", name: "Draft" }));
    for (const created of [later, sooner]) {
      if (!created.ok) throw new Error(created.error);
      await h
        .as(manager)
        .publishCompetition({ competitionId: created.competition.id });
    }

    const listed = await h.as(h.visitor()).listPublishedCompetitions();

    expect(listed.map((c) => c.code)).toEqual(["NEIGH27", "WATER27"]);
    expect(await h.as(h.visitor()).publishedCompetitionSlugs()).toEqual([
      "a-bowl-of-water",
      "neighbours-on-my-street",
    ]);
  });

  it("finds nothing for a slug that can't be one", async () => {
    const h = await createHarness();

    expect(
      await h.as(h.visitor()).getPublishedCompetition({ slug: "No Such/Slug" })
    ).toBeNull();
  });

  it("is open to visitors, members and staff alike", async () => {
    const h = await createHarness();
    const member = await signInWith(h, null);

    expect(await h.as(member).listPublishedCompetitions()).toEqual([]);
    expect(
      await h
        .as({ kind: "system", process: "worker" })
        .publishedCompetitionSlugs()
    ).toEqual([]);
  });
});

describe("previewCompetition", () => {
  it("shows a complete draft as the public page will once it is published", async () => {
    const { h, manager, competitionId } = await setUp();

    expect(await h.as(manager).previewCompetition({ competitionId })).toEqual({
      ok: true,
      status: "draft",
      problems: [],
      competition: publicView(competitionId, h.clock.now()),
    });
  });

  it("lists what an incomplete draft still needs, with nothing to show yet", async () => {
    const { h, manager, competitionId } = await setUp(
      completeFields({ theme: "" })
    );

    expect(await h.as(manager).previewCompetition({ competitionId })).toEqual({
      ok: true,
      status: "draft",
      problems: [{ field: "theme", code: "required" }],
      competition: null,
    });
  });

  it("says not found for an id that names no competition", async () => {
    const { h, manager } = await setUp();

    expect(
      await h.as(manager).previewCompetition({
        competitionId: "01938a00-0000-7000-8000-0000000000ff",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    ["a manager scoped to another competition", "other"],
    ["a content manager", "content_manager"],
    ["a member", null],
    ["a visitor", "visitor"],
  ] as const)("refuses %s", async (_who, kind) => {
    const { h, competitionId } = await setUp();
    const actor =
      kind === "visitor"
        ? h.visitor()
        : kind === "other"
          ? await signInManager(h, {
              type: "competition",
              id: OTHER_COMPETITION,
            })
          : await signInWith(h, kind);

    await expect(
      h.as(actor).previewCompetition({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
