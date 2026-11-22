import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import type { CompetitionFields } from "@/server/modules/competitions";
import { completeFields } from "@/server/modules/competitions/testing";
import type { Discipline } from "@/server/modules/competitions/domain/vocabulary";
import { createHarness, type Harness } from "@/test/harness";

import { globalManager, signedInWith } from "./testing";

// A move into school judging the guard refused is made by itself once the
// last missing rubric is published, if its date has passed (owner,
// 2026-11-19): publishing is enough, without waiting for another status
// job. Times are IST in the form and UTC here.

const KEY_DATES: CompetitionFields["keyDates"] = {
  registration_opens: "2027-02-01T09:00",
  registration_closes: "2027-02-20T18:00",
  submissions_close: "2027-02-28T23:59",
  school_round_closes: "2027-03-10T18:00",
};
const SUBMISSIONS_CLOSE = new Date("2027-02-28T18:29:00.000Z");

/** A published competition running `disciplines`, every date still ahead. */
async function setUp(
  overrides: Partial<CompetitionFields> = {},
  disciplines: Discipline[] = ["drawing", "essay"]
) {
  const h = await createHarness();
  const manager = await signedInWith(h, globalManager);
  const created = await h.as(manager).createCompetition(
    completeFields({
      disciplines,
      categories: disciplines.map((discipline) => ({
        discipline,
        ageGroup: "Group B",
      })),
      keyDates: KEY_DATES,
      ...overrides,
    })
  );
  if (!created.ok) throw new Error(created.error);
  const competitionId = created.competition.id;
  const published = await h.as(manager).publishCompetition({ competitionId });
  if (!published.ok) throw new Error(published.error);
  return { h, manager, competitionId };
}

async function publishRubric(
  h: Harness,
  manager: Actor,
  competitionId: string,
  discipline: Discipline
) {
  const draft = await h
    .as(manager)
    .createRubricDraft({ competitionId, discipline });
  if (!draft.ok) throw new Error(`createRubricDraft: ${draft.error}`);
  const published = await h
    .as(manager)
    .publishRubric({ rubricId: draft.rubric.id });
  if (!published.ok) throw new Error(`publishRubric: ${published.error}`);
}

/** Submissions close with only `published` having a rubric: refused. */
async function blockedAtSubmissionsClose(
  h: Harness,
  manager: Actor,
  competitionId: string,
  published: Discipline[]
) {
  for (const discipline of published) {
    await publishRubric(h, manager, competitionId, discipline);
  }
  h.clock.set(SUBMISSIONS_CLOSE);
  await h.drain();
  const page = await rubricsPage(h, manager, competitionId);
  if (page.schoolJudgingBlock === null) {
    throw new Error("The move into school judging was not refused");
  }
}

async function rubricsPage(h: Harness, manager: Actor, competitionId: string) {
  const page = await h.as(manager).listRubrics({ competitionId });
  if (!page.ok) throw new Error(page.error);
  return page;
}

async function statusChanges(h: Harness) {
  const rows = await h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "competition.status_changed"))
    .orderBy(asc(auditLog.id));
  return rows.map(({ actorKind, actorProcess, before, after, occurredAt }) => ({
    actorKind,
    actorProcess,
    before,
    after,
    occurredAt,
  }));
}

function noticesTo(h: Harness, subject: string) {
  return h.email.sent.filter((message) => message.subject === subject);
}

describe("re-running a refused move into school judging", () => {
  it("moves into school judging once the last missing rubric is published, without another status job", async () => {
    const { h, manager, competitionId } = await setUp();
    await blockedAtSubmissionsClose(h, manager, competitionId, ["drawing"]);
    h.clock.advance({ hours: 3 });
    const publishedAt = h.clock.now();

    await publishRubric(h, manager, competitionId, "essay");
    await h.drain();

    const page = await rubricsPage(h, manager, competitionId);
    expect(page.competition.status).toBe("school_judging");
    expect(page.schoolJudgingBlock).toBeNull();
    expect((await statusChanges(h)).at(-1)).toEqual({
      actorKind: "system",
      actorProcess: "worker",
      before: { status: "registration_closed" },
      after: {
        status: "school_judging",
        keyDate: "submissions_close",
        at: SUBMISSIONS_CLOSE.toISOString(),
      },
      occurredAt: publishedAt,
    });
  });

  it("stays refused while another discipline still lacks a rubric, and tells nobody again", async () => {
    const { h, manager, competitionId } = await setUp({
      name: "Water for Every Bird",
    });
    await blockedAtSubmissionsClose(h, manager, competitionId, []);
    const subject = "Water for Every Bird can't move to school judging yet";
    expect(noticesTo(h, subject).length).toBeGreaterThan(0);
    const told = noticesTo(h, subject).length;

    await publishRubric(h, manager, competitionId, "drawing");
    await h.drain();

    let page = await rubricsPage(h, manager, competitionId);
    expect(page.competition.status).toBe("registration_closed");
    expect(page.schoolJudgingBlock).toEqual({
      blockedAt: SUBMISSIONS_CLOSE,
      missing: ["essay"],
    });
    expect(noticesTo(h, subject)).toHaveLength(told);

    await publishRubric(h, manager, competitionId, "essay");
    await h.drain();

    page = await rubricsPage(h, manager, competitionId);
    expect(page.competition.status).toBe("school_judging");
    expect(page.schoolJudgingBlock).toBeNull();
  });

  it("moves into school judging once the manager drops the discipline without a rubric, without another status job", async () => {
    const { h, manager, competitionId } = await setUp();
    await blockedAtSubmissionsClose(h, manager, competitionId, ["drawing"]);
    h.clock.advance({ hours: 3 });
    const droppedAt = h.clock.now();

    const updated = await h.as(manager).updateCompetition({
      competitionId,
      disciplines: ["drawing"],
      categories: [{ discipline: "drawing", ageGroup: "Group B" }],
    });
    expect(updated).toEqual({ ok: true, changed: true });
    await h.drain();

    const page = await rubricsPage(h, manager, competitionId);
    expect(page.competition.status).toBe("school_judging");
    expect(page.schoolJudgingBlock).toBeNull();
    expect((await statusChanges(h)).at(-1)).toEqual({
      actorKind: "system",
      actorProcess: "worker",
      before: { status: "registration_closed" },
      after: {
        status: "school_judging",
        keyDate: "submissions_close",
        at: SUBMISSIONS_CLOSE.toISOString(),
      },
      occurredAt: droppedAt,
    });
  });

  it("names the discipline now missing when the manager swaps one without a rubric for another, and tells nobody again", async () => {
    const { h, manager, competitionId } = await setUp({
      name: "Shade for Street Dogs",
    });
    await blockedAtSubmissionsClose(h, manager, competitionId, ["drawing"]);
    const subject = "Shade for Street Dogs can't move to school judging yet";
    const told = noticesTo(h, subject).length;
    expect(told).toBeGreaterThan(0);

    const updated = await h.as(manager).updateCompetition({
      competitionId,
      disciplines: ["drawing", "painting"],
      categories: [
        { discipline: "drawing", ageGroup: "Group B" },
        { discipline: "painting", ageGroup: "Group B" },
      ],
    });
    expect(updated).toEqual({ ok: true, changed: true });
    await h.drain();

    const page = await rubricsPage(h, manager, competitionId);
    expect(page.competition.status).toBe("registration_closed");
    expect(page.schoolJudgingBlock).toEqual({
      blockedAt: SUBMISSIONS_CLOSE,
      missing: ["painting"],
    });
    expect(noticesTo(h, subject)).toHaveLength(told);
  });

  it("doesn't move early when submissions were given more time; the new date's job does", async () => {
    const { h, manager, competitionId } = await setUp();
    await blockedAtSubmissionsClose(h, manager, competitionId, ["drawing"]);
    const later = {
      ...KEY_DATES,
      submissions_close: "2027-03-05T23:59",
      school_round_closes: "2027-03-15T18:00",
    };
    const updated = await h
      .as(manager)
      .updateCompetition({ competitionId, keyDates: later });
    expect(updated).toEqual({ ok: true, changed: true });

    await publishRubric(h, manager, competitionId, "essay");
    await h.drain();
    expect(
      (await rubricsPage(h, manager, competitionId)).competition.status
    ).toBe("registration_closed");

    const newClose = new Date("2027-03-05T18:29:00.000Z");
    h.clock.set(new Date(newClose.getTime() - 1));
    await h.drain();
    expect(
      (await rubricsPage(h, manager, competitionId)).competition.status
    ).toBe("registration_closed");

    h.clock.set(newClose);
    await h.drain();
    const page = await rubricsPage(h, manager, competitionId);
    expect(page.competition.status).toBe("school_judging");
    expect(page.schoolJudgingBlock).toBeNull();
    expect((await statusChanges(h)).at(-1)?.after).toEqual({
      status: "school_judging",
      keyDate: "submissions_close",
      at: newClose.toISOString(),
    });
  });

  it("lets an individuals-only competition through the same way", async () => {
    const { h, manager, competitionId } = await setUp({
      participation: "individuals",
      keyDates: {
        registration_opens: KEY_DATES.registration_opens,
        registration_closes: KEY_DATES.registration_closes,
        submissions_close: KEY_DATES.submissions_close,
      },
    });
    await blockedAtSubmissionsClose(h, manager, competitionId, ["essay"]);

    await publishRubric(h, manager, competitionId, "drawing");
    await h.drain();

    const page = await rubricsPage(h, manager, competitionId);
    expect(page.competition.status).toBe("school_judging");
    expect(page.schoolJudgingBlock).toBeNull();
  });

  it("moves nothing when a rubric is published before submissions close", async () => {
    const { h, manager, competitionId } = await setUp();
    h.clock.set(new Date(SUBMISSIONS_CLOSE.getTime() - 60_000));
    await h.drain();

    await publishRubric(h, manager, competitionId, "drawing");
    await publishRubric(h, manager, competitionId, "essay");
    await h.drain();

    expect(
      (await rubricsPage(h, manager, competitionId)).competition.status
    ).toBe("registration_closed");
  });
});
