import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import type { Discipline } from "@/server/modules/competitions/domain/vocabulary";
import {
  registeredInstitution,
  signedInStaff,
} from "@/server/modules/institutions/testing";
import { createHarness, type Harness } from "@/test/harness";

import { globalManager, seedCompetition, signedInWith } from "./testing";

// Coordinators of registered institutions read FOA's judging guide for a
// competition before their school round opens: the published rubric of
// each discipline it runs (#88). Drafts and replaced versions are never
// shown. Until registration for a competition exists (#75), "registered"
// means FOA has verified the institution (#73).

const RUBRIC = [
  {
    label: "Kindness to animals",
    description: "The animal is shown with care.",
    weight: 60,
    minScore: 0,
    maxScore: 10,
  },
  {
    label: "Originality",
    description: "",
    weight: 40,
    minScore: 0,
    maxScore: 10,
  },
];
const REVISED = [
  { ...RUBRIC[0]!, weight: 50 },
  { label: "Effort", description: "", weight: 50, minScore: 1, maxScore: 5 },
];

let schools = 0;

/** An institution in `state`, and a signed-in coordinator of it. */
async function coordinatorOf(
  h: Harness,
  state: "verified" | "pending" | "suspended" = "verified"
) {
  schools += 1;
  const { institutionId, actor: admin } = await registeredInstitution(h, {
    name: `School number ${schools}`,
    contactEmail: `office-${schools}@school.example.test`,
  });
  if (state !== "pending") {
    const staff = await signedInStaff(h);
    await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Checked with the principal",
    });
    if (state === "suspended") {
      await h.as(staff).decideInstitution({
        institutionId,
        decision: "suspend",
        reason: "Complaint under review",
      });
    }
  }
  const coordinator = await signedInWith(h, {
    role: "institution_coordinator",
    scope: { type: "institution", id: institutionId },
  });
  return { institutionId, coordinator, admin };
}

async function publish(
  h: Harness,
  manager: Actor,
  competitionId: string,
  discipline: Discipline,
  criteria = RUBRIC
) {
  const draft = await h
    .as(manager)
    .createRubricDraft({ competitionId, discipline });
  if (!draft.ok) throw new Error(`createRubricDraft: ${draft.error}`);
  await h
    .as(manager)
    .updateRubricDraft({ rubricId: draft.rubric.id, criteria });
  const published = await h
    .as(manager)
    .publishRubric({ rubricId: draft.rubric.id });
  if (!published.ok) throw new Error(`publishRubric: ${published.error}`);
  return draft.rubric.id;
}

async function revise(
  h: Harness,
  manager: Actor,
  rubricId: string,
  criteria: typeof RUBRIC
) {
  const next = await h.as(manager).startRubricRevision({ rubricId });
  if (!next.ok) throw new Error(`startRubricRevision: ${next.error}`);
  await h.as(manager).updateRubricDraft({ rubricId: next.rubric.id, criteria });
  return next.rubric.id;
}

/**
 * A published competition running drawing, essay and craft: drawing
 * revised (v2 published, v3 a draft), essay published, craft only a draft.
 */
async function competitionWithRubrics(h: Harness) {
  const manager = await signedInWith(h, globalManager);
  const competition = await seedCompetition(h, {
    disciplines: ["drawing", "essay", "craft"],
    name: "Neighbours on My Street",
  });
  const v1 = await publish(h, manager, competition.id, "drawing");
  const v2 = await revise(h, manager, v1, REVISED);
  await h.as(manager).publishRubric({ rubricId: v2 });
  await revise(h, manager, v2, RUBRIC);
  await publish(h, manager, competition.id, "essay");
  await h
    .as(manager)
    .createRubricDraft({ competitionId: competition.id, discipline: "craft" });
  return { manager, competition };
}

describe("getJudgingGuide", () => {
  it("shows a coordinator the published rubric of each discipline, never a draft or an old version", async () => {
    const h = await createHarness();
    const { competition } = await competitionWithRubrics(h);
    const { coordinator } = await coordinatorOf(h);

    const guide = await h
      .as(coordinator)
      .getJudgingGuide({ code: competition.code });

    expect(guide).toEqual({
      ok: true,
      competition: {
        code: competition.code,
        name: "Neighbours on My Street",
        status: "published",
      },
      disciplines: [
        {
          discipline: "drawing",
          rubric: { version: 2, publishedAt: h.clock.now(), criteria: REVISED },
        },
        {
          discipline: "essay",
          rubric: { version: 1, publishedAt: h.clock.now(), criteria: RUBRIC },
        },
        { discipline: "craft", rubric: null },
      ],
    });
  });

  it("shows the institution's admin the same guide", async () => {
    const h = await createHarness();
    const { competition } = await competitionWithRubrics(h);
    const { admin } = await coordinatorOf(h);

    const guide = await h.as(admin).getJudgingGuide({ code: competition.code });

    expect(guide).toMatchObject({ ok: true });
  });

  it("knows no draft competition, no individuals-only one and no unknown code", async () => {
    const h = await createHarness();
    const { coordinator } = await coordinatorOf(h);
    const draft = await seedCompetition(h, { status: "draft" });
    const individuals = await seedCompetition(h, {
      participation: "individuals",
    });

    for (const code of [draft.code, individuals.code, "NOPE99"]) {
      expect(await h.as(coordinator).getJudgingGuide({ code }), code).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it("refuses coordinators of institutions FOA hasn't verified, participants, members and visitors", async () => {
    const h = await createHarness();
    const { competition } = await competitionWithRubrics(h);
    const pending = await coordinatorOf(h, "pending");
    const suspended = await coordinatorOf(h, "suspended");
    const participant = await signedInWith(h, {
      role: "participant",
      scope: { type: "global" },
    });
    const member = await signedInWith(h);

    for (const actor of [
      pending.coordinator,
      suspended.coordinator,
      participant,
      member,
      h.visitor(),
    ]) {
      await expect(
        h.as(actor).getJudgingGuide({ code: competition.code })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(h.as(actor).listJudgingGuides()).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });
});

describe("listJudgingGuides", () => {
  it("lists the published competitions schools take part in, for the dashboard", async () => {
    const h = await createHarness();
    const { competition } = await competitionWithRubrics(h);
    const schoolsOnly = await seedCompetition(h, {
      participation: "institutions",
      name: "Water for Every Bird",
    });
    await seedCompetition(h, { status: "draft" });
    await seedCompetition(h, { participation: "individuals" });
    const { coordinator } = await coordinatorOf(h);

    expect(await h.as(coordinator).listJudgingGuides()).toEqual([
      {
        code: competition.code,
        name: "Neighbours on My Street",
        status: "published",
      },
      {
        code: schoolsOnly.code,
        name: "Water for Every Bird",
        status: "published",
      },
    ]);
  });
});
