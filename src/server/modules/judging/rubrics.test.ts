import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  competition as competitionTable,
  rubric,
  rubricCriterion,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { defaultRubricCriteria } from "./domain/rubric-criteria";
import { isRubricFrozenError } from "./domain/rubric-freeze";
import {
  globalManager,
  managerOf,
  seedCompetition,
  signedInWith,
} from "./testing";

/** Four criteria whose weights total 100. */
const CRITERIA = [
  {
    label: "Kindness to animals",
    description: "",
    weight: 40,
    minScore: 0,
    maxScore: 10,
  },
  {
    label: "Originality",
    description: "A fresh idea",
    weight: 30,
    minScore: 0,
    maxScore: 10,
  },
  { label: "Technique", description: "", weight: 20, minScore: 0, maxScore: 5 },
  { label: "Effort", description: "", weight: 10, minScore: 1, maxScore: 5 },
];

async function setUp() {
  const h = await createHarness();
  const competition = await seedCompetition(h, {
    disciplines: ["drawing", "essay"],
  });
  const manager = await signedInWith(h, managerOf(competition.id));
  return { h, competition, manager };
}

async function publishedRubric(
  h: Harness,
  manager: Actor,
  competitionId: string,
  discipline: "drawing" | "essay" = "drawing"
) {
  const created = await h
    .as(manager)
    .createRubricDraft({ competitionId, discipline });
  if (!created.ok) throw new Error(`createRubricDraft: ${created.error}`);
  const rubricId = created.rubric.id;
  await h.as(manager).updateRubricDraft({ rubricId, criteria: CRITERIA });
  const published = await h.as(manager).publishRubric({ rubricId });
  if (!published.ok) throw new Error(`publishRubric: ${published.error}`);
  return published.rubric;
}

async function criteriaRows(h: Harness, rubricId: string) {
  return h.db
    .select({
      label: rubricCriterion.label,
      description: rubricCriterion.description,
      weight: rubricCriterion.weight,
      minScore: rubricCriterion.minScore,
      maxScore: rubricCriterion.maxScore,
    })
    .from(rubricCriterion)
    .where(eq(rubricCriterion.rubricId, rubricId))
    .orderBy(asc(rubricCriterion.position));
}

async function rubricAudit(h: Harness) {
  return h.db.select().from(auditLog).where(eq(auditLog.entityType, "rubric"));
}

describe("writing and publishing a rubric", () => {
  it("starts a draft from the default judging guide, saves edits and publishes it", async () => {
    const { h, competition, manager } = await setUp();

    const created = await h
      .as(manager)
      .createRubricDraft({
        competitionId: competition.id,
        discipline: "drawing",
      });
    expect(created).toMatchObject({
      ok: true,
      rubric: {
        competitionId: competition.id,
        discipline: "drawing",
        version: 1,
        status: "draft",
        criteria: defaultRubricCriteria(),
      },
    });
    if (!created.ok) return;
    const rubricId = created.rubric.id;

    expect(
      await h.as(manager).updateRubricDraft({ rubricId, criteria: CRITERIA })
    ).toMatchObject({
      ok: true,
      rubric: { status: "draft", criteria: CRITERIA },
    });

    h.clock.advance({ minutes: 5 });
    expect(await h.as(manager).publishRubric({ rubricId })).toMatchObject({
      ok: true,
      rubric: {
        id: rubricId,
        version: 1,
        status: "published",
        publishedAt: h.clock.now(),
        criteria: CRITERIA,
      },
    });

    expect(
      await h.as(manager).listRubrics({ competitionId: competition.id })
    ).toEqual({
      ok: true,
      competition: {
        id: competition.id,
        code: competition.code,
        name: competition.name,
        status: "published",
      },
      disciplines: [
        {
          discipline: "drawing",
          published: { id: rubricId, version: 1, publishedAt: h.clock.now() },
          draft: null,
        },
        { discipline: "essay", published: null, draft: null },
      ],
    });
  });

  it("saves a half-finished draft, and keeps the criteria in the order given", async () => {
    const { h, competition, manager } = await setUp();
    const created = await h
      .as(manager)
      .createRubricDraft({
        competitionId: competition.id,
        discipline: "essay",
      });
    if (!created.ok) throw new Error(created.error);
    const rubricId = created.rubric.id;
    const halfDone = [CRITERIA[1]!, CRITERIA[0]!];

    await h.as(manager).updateRubricDraft({ rubricId, criteria: halfDone });

    expect(await criteriaRows(h, rubricId)).toEqual(halfDone);
  });

  it("refuses criteria that break the rules, and keeps the draft as it was", async () => {
    const { h, competition, manager } = await setUp();
    const created = await h
      .as(manager)
      .createRubricDraft({
        competitionId: competition.id,
        discipline: "drawing",
      });
    if (!created.ok) throw new Error(created.error);
    const rubricId = created.rubric.id;

    expect(
      await h.as(manager).updateRubricDraft({
        rubricId,
        criteria: [{ ...CRITERIA[0]!, minScore: 10, maxScore: 10 }],
      })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["criteria"] });
    expect(await criteriaRows(h, rubricId)).toEqual(defaultRubricCriteria());
  });

  it("refuses a draft for a discipline the competition doesn't run", async () => {
    const { h, competition, manager } = await setUp();

    expect(
      await h.as(manager).createRubricDraft({
        competitionId: competition.id,
        discipline: "photography",
      })
    ).toEqual({ ok: false, error: "discipline_not_enabled" });
    expect(await h.db.select().from(rubric)).toEqual([]);
  });

  it("refuses a second rubric for a discipline that has one", async () => {
    const { h, competition, manager } = await setUp();
    const input = {
      competitionId: competition.id,
      discipline: "drawing",
    } as const;
    await h.as(manager).createRubricDraft(input);

    expect(await h.as(manager).createRubricDraft(input)).toEqual({
      ok: false,
      error: "rubric_exists",
    });
  });

  it("says not_found for a competition or rubric that doesn't exist", async () => {
    const { h, manager: scoped } = await setUp();
    const manager = await signedInWith(h, globalManager);
    const missing = "01938a00-0000-7000-8000-0000000000ff";

    expect(
      await h
        .as(manager)
        .createRubricDraft({ competitionId: missing, discipline: "drawing" })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await h.as(manager).publishRubric({ rubricId: missing })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await h.as(manager).listRubrics({ competitionId: missing })).toEqual(
      { ok: false, error: "not_found" }
    );
    // A manager of one competition learns nothing about other ids.
    await expect(
      h.as(scoped).publishRubric({ rubricId: missing })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("a published rubric is read-only", () => {
  it("refuses edits through the use case and keeps its criteria", async () => {
    const { h, competition, manager } = await setUp();
    const published = await publishedRubric(h, manager, competition.id);

    expect(
      await h.as(manager).updateRubricDraft({
        rubricId: published.id,
        criteria: [{ ...CRITERIA[0]!, weight: 100 }],
      })
    ).toEqual({ ok: false, error: "rubric_not_editable" });
    expect(
      await h.as(manager).publishRubric({ rubricId: published.id })
    ).toEqual({ ok: false, error: "rubric_not_editable" });
    expect(await criteriaRows(h, published.id)).toEqual(CRITERIA);
  });

  it("is frozen by the database too: a direct change fails with the error the use cases map", async () => {
    const { h, competition, manager } = await setUp();
    const published = await publishedRubric(h, manager, competition.id);
    const refusal = (write: PromiseLike<unknown>) =>
      Promise.resolve(write).then(
        () => "written",
        (error: unknown) =>
          isRubricFrozenError(error) ? "rubric_not_editable" : error
      );

    expect(
      await refusal(
        h.db
          .update(rubricCriterion)
          .set({ weight: 100 })
          .where(eq(rubricCriterion.rubricId, published.id))
      )
    ).toBe("rubric_not_editable");
    expect(
      await refusal(
        h.db
          .delete(rubricCriterion)
          .where(eq(rubricCriterion.rubricId, published.id))
      )
    ).toBe("rubric_not_editable");
    expect(
      await refusal(
        h.db
          .insert(rubricCriterion)
          .values({
            ...CRITERIA[0]!,
            id: crypto.randomUUID(),
            rubricId: published.id,
            position: 9,
          })
      )
    ).toBe("rubric_not_editable");
    expect(
      await refusal(
        h.db
          .update(rubric)
          .set({ version: 7 })
          .where(eq(rubric.id, published.id))
      )
    ).toBe("rubric_not_editable");
    expect(
      await refusal(
        h.db
          .update(rubric)
          .set({ status: "draft", publishedAt: null })
          .where(eq(rubric.id, published.id))
      )
    ).toBe("rubric_not_editable");
    expect(
      await refusal(h.db.delete(rubric).where(eq(rubric.id, published.id)))
    ).toBe("rubric_not_editable");
    expect(await criteriaRows(h, published.id)).toEqual(CRITERIA);
  });
});

describe("revising a published rubric", () => {
  it("copies it into the next version's draft, and publishing that supersedes the old one, unchanged", async () => {
    const { h, competition, manager } = await setUp();
    const v1 = await publishedRubric(h, manager, competition.id);

    const revision = await h
      .as(manager)
      .startRubricRevision({ rubricId: v1.id });
    expect(revision).toMatchObject({
      ok: true,
      rubric: { version: 2, status: "draft", criteria: CRITERIA },
    });
    if (!revision.ok) return;
    const v2Criteria = [
      { ...CRITERIA[0]!, weight: 50 },
      { ...CRITERIA[1]!, weight: 50 },
    ];
    await h
      .as(manager)
      .updateRubricDraft({
        rubricId: revision.rubric.id,
        criteria: v2Criteria,
      });
    // Until the new version is published, the old one is the one in force.
    expect(await criteriaRows(h, v1.id)).toEqual(CRITERIA);

    h.clock.advance({ days: 1 });
    expect(
      await h.as(manager).publishRubric({ rubricId: revision.rubric.id })
    ).toMatchObject({ ok: true, rubric: { version: 2, status: "published" } });

    const versions = await h.db
      .select()
      .from(rubric)
      .where(
        and(
          eq(rubric.competitionId, competition.id),
          eq(rubric.discipline, "drawing")
        )
      )
      .orderBy(asc(rubric.version));
    expect(
      versions.map(({ version, status }) => ({ version, status }))
    ).toEqual([
      { version: 1, status: "superseded" },
      { version: 2, status: "published" },
    ]);
    expect(versions[0]!.publishedAt).toEqual(v1.publishedAt);
    expect(await criteriaRows(h, v1.id)).toEqual(CRITERIA);
    expect(await criteriaRows(h, revision.rubric.id)).toEqual(v2Criteria);

    expect(
      await h.as(manager).getDisciplineRubrics({
        competitionId: competition.id,
        discipline: "drawing",
      })
    ).toMatchObject({
      ok: true,
      rubrics: [
        { version: 2, status: "published", criteria: v2Criteria },
        { version: 1, status: "superseded", criteria: CRITERIA },
      ],
    });
  });

  it("refuses a second revision while one is a draft, and a revision of a draft", async () => {
    const { h, competition, manager } = await setUp();
    const v1 = await publishedRubric(h, manager, competition.id);
    const revision = await h
      .as(manager)
      .startRubricRevision({ rubricId: v1.id });
    if (!revision.ok) throw new Error(revision.error);

    expect(
      await h.as(manager).startRubricRevision({ rubricId: v1.id })
    ).toEqual({ ok: false, error: "draft_exists" });
    expect(
      await h.as(manager).startRubricRevision({ rubricId: revision.rubric.id })
    ).toEqual({ ok: false, error: "not_published" });
  });

  it("can't start, revise or publish a rubric once the competition is in school judging", async () => {
    const h = await createHarness();
    const competition = await seedCompetition(h, {
      disciplines: ["drawing", "painting", "essay"],
    });
    const manager = await signedInWith(h, managerOf(competition.id));
    const drawing = await publishedRubric(h, manager, competition.id);
    const essay = await h
      .as(manager)
      .createRubricDraft({
        competitionId: competition.id,
        discipline: "essay",
      });
    if (!essay.ok) throw new Error(essay.error);
    await h
      .as(manager)
      .updateRubricDraft({ rubricId: essay.rubric.id, criteria: CRITERIA });
    await h.db
      .update(competitionTable)
      .set({ status: "school_judging" })
      .where(eq(competitionTable.id, competition.id));
    const auditBefore = await rubricAudit(h);

    expect(
      await h.as(manager).publishRubric({ rubricId: essay.rubric.id })
    ).toEqual({ ok: false, error: "rubric_locked_by_judging" });
    expect(
      await h.as(manager).startRubricRevision({ rubricId: drawing.id })
    ).toEqual({ ok: false, error: "rubric_locked_by_judging" });
    expect(
      await h.as(manager).createRubricDraft({
        competitionId: competition.id,
        discipline: "painting",
      })
    ).toEqual({ ok: false, error: "rubric_locked_by_judging" });
    expect(await rubricAudit(h)).toEqual(auditBefore);
  });
});

describe("publishing checks the criteria", () => {
  it("names every problem and changes nothing", async () => {
    const { h, competition, manager } = await setUp();
    const created = await h
      .as(manager)
      .createRubricDraft({
        competitionId: competition.id,
        discipline: "drawing",
      });
    if (!created.ok) throw new Error(created.error);
    const rubricId = created.rubric.id;

    await h.as(manager).updateRubricDraft({ rubricId, criteria: [] });
    expect(await h.as(manager).publishRubric({ rubricId })).toEqual({
      ok: false,
      error: "not_publishable",
      problems: [{ code: "no_criteria" }],
    });

    await h.as(manager).updateRubricDraft({
      rubricId,
      criteria: [CRITERIA[0]!, CRITERIA[1]!],
    });
    expect(await h.as(manager).publishRubric({ rubricId })).toEqual({
      ok: false,
      error: "not_publishable",
      problems: [{ code: "weights_total", total: 70 }],
    });

    const [row] = await h.db
      .select()
      .from(rubric)
      .where(eq(rubric.id, rubricId));
    expect(row).toMatchObject({ status: "draft", publishedAt: null });
    expect(await rubricAudit(h)).toEqual([]);
  });
});

describe("the audit log", () => {
  it("records one entry when a rubric is published", async () => {
    const { h, competition, manager } = await setUp();
    if (manager.kind !== "user") throw new Error("expected a user");

    const published = await publishedRubric(h, manager, competition.id);

    expect(await rubricAudit(h)).toEqual([
      expect.objectContaining({
        action: "rubric.published",
        entityType: "rubric",
        entityId: published.id,
        actorKind: "user",
        actorUserId: manager.userId,
        actorRole: "competition_manager",
        before: { status: "draft", version: 1 },
        after: { status: "published", version: 1 },
      }),
    ]);
  });
});

describe("who may manage rubrics", () => {
  type Who = {
    name: string;
    actor: (h: Harness, id: string) => Promise<Actor>;
  };
  const allowed: Who[] = [
    {
      name: "a manager of this competition",
      actor: (h, id) => signedInWith(h, managerOf(id)),
    },
    {
      name: "a manager of every competition",
      actor: (h) => signedInWith(h, globalManager),
    },
  ];
  const refused: Who[] = [
    {
      name: "a manager of another competition",
      actor: async (h) => {
        const other = await seedCompetition(h);
        return signedInWith(h, managerOf(other.id));
      },
    },
    {
      name: "a school coordinator",
      actor: (h) =>
        signedInWith(h, {
          role: "institution_coordinator",
          scope: {
            type: "institution",
            id: "01938a00-0000-7000-8000-00000000a001",
          },
        }),
    },
    { name: "a member", actor: (h) => signedInWith(h) },
    { name: "a visitor", actor: async (h) => h.visitor() },
  ];

  /**
   * Each use case, run against a competition with a published drawing
   * rubric, an essay draft and no painting rubric yet.
   */
  const useCases = {
    listRubrics: (h: Harness, actor: Actor, ids: Ids) =>
      h.as(actor).listRubrics({ competitionId: ids.competitionId }),
    getDisciplineRubrics: (h: Harness, actor: Actor, ids: Ids) =>
      h.as(actor).getDisciplineRubrics({
        competitionId: ids.competitionId,
        discipline: "drawing",
      }),
    createRubricDraft: (h: Harness, actor: Actor, ids: Ids) =>
      h.as(actor).createRubricDraft({
        competitionId: ids.competitionId,
        discipline: "painting",
      }),
    updateRubricDraft: (h: Harness, actor: Actor, ids: Ids) =>
      h
        .as(actor)
        .updateRubricDraft({ rubricId: ids.draftId, criteria: CRITERIA }),
    publishRubric: (h: Harness, actor: Actor, ids: Ids) =>
      h.as(actor).publishRubric({ rubricId: ids.draftId }),
    startRubricRevision: (h: Harness, actor: Actor, ids: Ids) =>
      h.as(actor).startRubricRevision({ rubricId: ids.publishedId }),
  };
  type Ids = { competitionId: string; publishedId: string; draftId: string };

  async function world() {
    const h = await createHarness();
    const competition = await seedCompetition(h, {
      disciplines: ["drawing", "painting", "essay"],
    });
    const manager = await signedInWith(h, managerOf(competition.id));
    const published = await publishedRubric(h, manager, competition.id);
    const draft = await h
      .as(manager)
      .createRubricDraft({
        competitionId: competition.id,
        discipline: "essay",
      });
    if (!draft.ok) throw new Error(draft.error);
    await h
      .as(manager)
      .updateRubricDraft({ rubricId: draft.rubric.id, criteria: CRITERIA });
    const ids: Ids = {
      competitionId: competition.id,
      publishedId: published.id,
      draftId: draft.rubric.id,
    };
    return { h, ids };
  }

  async function snapshot(h: Harness) {
    return {
      rubrics: await h.db.select().from(rubric).orderBy(asc(rubric.id)),
      criteria: await h.db
        .select()
        .from(rubricCriterion)
        .orderBy(asc(rubricCriterion.id)),
      audit: await h.db.select().from(auditLog).orderBy(asc(auditLog.id)),
    };
  }

  for (const [name, run] of Object.entries(useCases)) {
    for (const who of allowed) {
      it(`${name}: ${who.name} may`, async () => {
        const { h, ids } = await world();
        const actor = await who.actor(h, ids.competitionId);

        await expect(run(h, actor, ids)).resolves.toMatchObject({ ok: true });
      });
    }
    for (const who of refused) {
      it(`${name}: ${who.name} may not, and nothing changes`, async () => {
        const { h, ids } = await world();
        const actor = await who.actor(h, ids.competitionId);
        const before = await snapshot(h);

        await expect(run(h, actor, ids)).rejects.toMatchObject({
          code: "forbidden",
        });
        expect(await snapshot(h)).toEqual(before);
      });
    }
  }
});
