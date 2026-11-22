import { asc, eq } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import adminRubrics from "../../../../messages/en-IN/adminRubrics.json";
import competitionStatus from "../../../../messages/en-IN/competitionStatus.json";
import { formats, LOCALE } from "@/i18n/formats";

import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import type { Discipline } from "@/server/modules/competitions/domain/vocabulary";
import { SUBSCRIBERS } from "@/server/outbox/events";
import { createHarness, type Harness } from "@/test/harness";

import type { CompetitionFields } from ".";
import { completeFields } from "./testing";
import { TRANSITION_GUARDS } from "./transition-guards";

// The schedule moves a competition into school judging when submissions
// close, but only once every discipline it runs has a published rubric
// (#88). Otherwise the move is refused: the competition stays where it
// is, the refusal is recorded, and its competition managers are told
// which disciplines still lack a rubric. Times are IST in the form and
// UTC here.

const KEY_DATES: CompetitionFields["keyDates"] = {
  registration_opens: "2027-02-01T09:00",
  registration_closes: "2027-02-20T18:00",
  submissions_close: "2027-02-28T23:59",
  school_round_closes: "2027-03-10T18:00",
};
const SUBMISSIONS_CLOSE = new Date("2027-02-28T18:29:00.000Z");

type Person = { actor: Actor; email: string; userId: string };

async function person(
  h: Harness,
  grant?: Parameters<Harness["seed"]["grant"]>[1]
): Promise<Person> {
  const user = await h.seed.member();
  if (grant) await h.seed.grant(user, grant);
  const actor = await h.signIn(user);
  return { actor, email: user.email, userId: user.id };
}

/**
 * A competition running drawing and essay, published by a global manager
 * with every key date still ahead, and a manager scoped to it.
 */
async function setUp(
  overrides: Partial<CompetitionFields> = {},
  disciplines: Discipline[] = ["drawing", "essay"]
) {
  const h = await createHarness();
  const global = await person(h, {
    role: "competition_manager",
    scope: { type: "global" },
  });
  const created = await h.as(global.actor).createCompetition(
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
  const published = await h
    .as(global.actor)
    .publishCompetition({ competitionId });
  if (!published.ok) throw new Error(published.error);
  const scoped = await person(h, {
    role: "competition_manager",
    scope: { type: "competition", id: competitionId },
  });
  return { h, global, scoped, competitionId };
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

async function rubricsPage(h: Harness, manager: Actor, competitionId: string) {
  const page = await h.as(manager).listRubrics({ competitionId });
  if (!page.ok) throw new Error(page.error);
  return page;
}

async function auditOf(h: Harness, action: string) {
  return h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, action))
    .orderBy(asc(auditLog.id));
}

function noticesTo(h: Harness, email: string) {
  return h.email.sent.filter(
    (message) => message.to === email && !message.subject.includes("code")
  );
}

describe("the school-judging guard on the scheduled move", () => {
  it("keeps a competition out of school judging while a discipline lacks a published rubric", async () => {
    const { h, global, competitionId } = await setUp();
    await publishRubric(h, global.actor, competitionId, "drawing");

    h.clock.set(SUBMISSIONS_CLOSE);
    await h.drain();

    const page = await rubricsPage(h, global.actor, competitionId);
    expect(page.competition.status).toBe("registration_closed");
    expect(page.schoolJudgingBlock).toEqual({
      blockedAt: SUBMISSIONS_CLOSE,
      missing: ["essay"],
    });
  });

  it("records the refusal once, by the system, naming what is missing", async () => {
    const { h, global, competitionId } = await setUp();
    await publishRubric(h, global.actor, competitionId, "drawing");

    h.clock.set(SUBMISSIONS_CLOSE);
    await h.drain();
    h.clock.advance({ minutes: 5 });
    await h.drain();

    const rows = await auditOf(h, "competition.transition_blocked");
    expect(rows).toEqual([
      expect.objectContaining({
        actorKind: "system",
        actorProcess: "worker",
        actorUserId: null,
        actorRole: null,
        entityType: "competition",
        entityId: competitionId,
        before: { status: "registration_closed" },
        after: {
          to: "school_judging",
          reason: "rubrics_missing",
          missingDisciplines: ["essay"],
        },
        occurredAt: SUBMISSIONS_CLOSE,
      }),
    ]);
    expect(
      (await auditOf(h, "competition.status_changed")).map(
        (row) => (row.after as { status: string }).status
      )
    ).toEqual(["registration_open", "registration_closed"]);
  });

  it("tells the scoped and the global competition managers once, by email and in-app", async () => {
    const { h, global, scoped, competitionId } = await setUp({
      name: "Neighbours on My Street",
      code: "NEIGH27",
    });
    const elsewhere = await person(h, {
      role: "competition_manager",
      scope: {
        type: "competition",
        id: "01938a00-0000-7000-8000-00000000dead",
      },
    });
    await publishRubric(h, global.actor, competitionId, "drawing");

    h.clock.set(SUBMISSIONS_CLOSE);
    await h.drain();
    h.clock.advance({ minutes: 5 });
    await h.drain();

    for (const manager of [global, scoped]) {
      const emails = noticesTo(h, manager.email);
      expect(emails).toHaveLength(1);
      expect(emails[0]?.subject).toBe(
        "Neighbours on My Street can't move to school judging yet"
      );
      expect(emails[0]?.text).toContain("NEIGH27");
      expect(emails[0]?.text).toContain(
        "These disciplines have no published rubric yet: Essay."
      );
      const inbox = await h.as(manager.actor).listInbox();
      expect(inbox).toEqual([
        expect.objectContaining({
          title: "Neighbours on My Street can't move to school judging yet",
          body: expect.stringContaining("Essay"),
        }),
      ]);
    }
    expect(noticesTo(h, elsewhere.email)).toEqual([]);
    expect(await h.as(elsewhere.actor).listInbox()).toEqual([]);
  });

  it("words the notice from messages/en-IN, naming disciplines as the rubrics page does", async () => {
    const { h, global, competitionId } = await setUp({}, [
      "drawing",
      "painting",
      "essay",
    ]);
    await publishRubric(h, global.actor, competitionId, "painting");

    h.clock.set(SUBMISSIONS_CLOSE);
    await h.drain();

    // FOA reviews this copy and staff can change it: it lives with the
    // rest of the copy, not in server code.
    const status = createTranslator({
      locale: LOCALE,
      messages: competitionStatus,
      namespace: "competitionStatus",
    });
    const discipline = createTranslator({
      locale: LOCALE,
      messages: adminRubrics,
      namespace: "adminRubrics.disciplines",
    });
    const format = createFormatter({ locale: LOCALE, formats });
    const missing = format.list(
      [discipline("drawing"), discipline("essay")],
      "and"
    );
    const [email] = noticesTo(h, global.email);
    expect(email?.subject).toContain(
      `can't move to ${status("inSentence.school_judging")} yet`
    );
    expect(email?.text).toContain(
      status("blockReason.rubrics_missing", { disciplines: missing })
    );
    expect(email?.text).toContain(
      "These disciplines have no published rubric yet: Drawing and Essay."
    );
  });

  it("guards an individuals-only competition the same way", async () => {
    const { h, global, competitionId } = await setUp({
      participation: "individuals",
      keyDates: {
        registration_opens: KEY_DATES.registration_opens,
        registration_closes: KEY_DATES.registration_closes,
        submissions_close: KEY_DATES.submissions_close,
      },
    });
    await publishRubric(h, global.actor, competitionId, "essay");

    h.clock.set(SUBMISSIONS_CLOSE);
    await h.drain();

    const page = await rubricsPage(h, global.actor, competitionId);
    expect(page.competition.status).toBe("registration_closed");
    expect(page.schoolJudgingBlock).toEqual({
      blockedAt: SUBMISSIONS_CLOSE,
      missing: ["drawing"],
    });
  });

  it("moves into school judging when submissions close if every rubric is published", async () => {
    const { h, global, competitionId } = await setUp();
    await publishRubric(h, global.actor, competitionId, "drawing");
    await publishRubric(h, global.actor, competitionId, "essay");

    h.clock.set(new Date(SUBMISSIONS_CLOSE.getTime() - 1));
    await h.drain();
    expect(
      (await rubricsPage(h, global.actor, competitionId)).competition.status
    ).toBe("registration_closed");

    h.clock.set(SUBMISSIONS_CLOSE);
    await h.drain();

    const page = await rubricsPage(h, global.actor, competitionId);
    expect(page.competition.status).toBe("school_judging");
    expect(page.schoolJudgingBlock).toBeNull();
    expect(await auditOf(h, "competition.transition_blocked")).toEqual([]);
    expect((await auditOf(h, "competition.status_changed")).at(-1)).toEqual(
      expect.objectContaining({
        actorKind: "system",
        before: { status: "registration_closed" },
        after: {
          status: "school_judging",
          keyDate: "submissions_close",
          at: SUBMISSIONS_CLOSE.toISOString(),
        },
      })
    );
    expect(noticesTo(h, global.email)).toEqual([]);
  });
});

describe("the guard list", () => {
  it("guards the move into school judging", () => {
    expect(TRANSITION_GUARDS.map((g) => `${g.from} -> ${g.to}`)).toContain(
      "registration_closed -> school_judging"
    );
  });

  it("tries a refused move again after each event its guard names", () => {
    for (const guard of TRANSITION_GUARDS) {
      const where = `${guard.from} -> ${guard.to}`;
      expect(guard.retryOn.length, where).toBeGreaterThan(0);
      for (const event of guard.retryOn) {
        const handlers: readonly string[] = SUBSCRIBERS[event];
        expect(handlers, `${where}: ${event}`).toContain(
          "competitions.retry_blocked_moves"
        );
      }
    }
  });
});
