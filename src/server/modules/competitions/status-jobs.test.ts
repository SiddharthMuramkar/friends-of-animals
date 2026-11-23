import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import type { CompetitionFields, UpdateCompetitionInput } from ".";
import { completeFields, signInManager, signInWith } from "./testing";

// The schedule moves a published competition's status at its key dates
// (#71): publishing saves one status job per key date, and draining at or
// after a date makes the move. All times below are IST in the form and UTC
// here: 09:00 IST is 03:30Z.

const KEY_DATES: CompetitionFields["keyDates"] = {
  registration_opens: "2027-02-01T09:00",
  registration_closes: "2027-02-20T18:00",
  submissions_close: "2027-02-28T23:59",
  school_round_closes: "2027-03-10T18:00",
};
const OPENS = new Date("2027-02-01T03:30:00.000Z");
const CLOSES = new Date("2027-02-20T12:30:00.000Z");

const WORKER: Actor = { kind: "system", process: "worker" };

/** A competition a manager has published with KEY_DATES (all still ahead). */
async function publishedCompetition(h: Harness) {
  const manager = await signInManager(h);
  const created = await h
    .as(manager)
    .createCompetition(completeFields({ keyDates: KEY_DATES }));
  if (!created.ok) throw new Error(created.error);
  const { id, slug } = created.competition;
  const published = await h
    .as(manager)
    .publishCompetition({ competitionId: id });
  if (!published.ok) throw new Error(published.error);
  return { manager, competitionId: id, slug };
}

/** The audit log's status changes, oldest first, as a reader sees them. */
async function statusChanges(h: Harness) {
  const rows = await h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "competition.status_changed"))
    .orderBy(asc(auditLog.id));
  return rows.map((row) => ({
    actorKind: row.actorKind,
    actorProcess: row.actorProcess,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    entity: `${row.entityType}:${row.entityId}`,
    before: row.before,
    after: row.after,
    occurredAt: row.occurredAt,
  }));
}

/** The status the public pages show for `slug`. */
async function publicStatus(h: Harness, slug: string) {
  const competition = await h.as(h.visitor()).getPublishedCompetition({ slug });
  return competition?.status;
}

describe("the status schedule", () => {
  it("opens registration at its instant and closes it at its own", async () => {
    const h = await createHarness();
    const { slug } = await publishedCompetition(h);

    await h.drain();
    expect(await publicStatus(h, slug)).toBe("published");

    h.clock.set(new Date(OPENS.getTime() - 1));
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("published");

    h.clock.set(OPENS);
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");

    h.clock.set(new Date(CLOSES.getTime() - 1));
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");

    h.clock.set(CLOSES);
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_closed");
  });

  it("records each move once, by the system, with the key date that made it", async () => {
    const h = await createHarness();
    const { competitionId } = await publishedCompetition(h);

    h.clock.set(OPENS);
    await h.drain();
    h.clock.set(CLOSES);
    await h.drain();
    await h.drain();

    const bySystem = {
      actorKind: "system",
      actorProcess: "worker",
      actorUserId: null,
      actorRole: null,
      entity: `competition:${competitionId}`,
    };
    expect(await statusChanges(h)).toEqual([
      {
        ...bySystem,
        before: { status: "published" },
        after: {
          status: "registration_open",
          keyDate: "registration_opens",
          at: "2027-02-01T03:30:00.000Z",
        },
        occurredAt: OPENS,
      },
      {
        ...bySystem,
        before: { status: "registration_open" },
        after: {
          status: "registration_closed",
          keyDate: "registration_closes",
          at: "2027-02-20T12:30:00.000Z",
        },
        occurredAt: CLOSES,
      },
    ]);
  });

  it("catches up on the first drain when published after both dates have passed", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const created = await h
      .as(manager)
      .createCompetition(completeFields({ keyDates: KEY_DATES }));
    if (!created.ok) throw new Error(created.error);
    const { id, slug } = created.competition;
    const late = new Date(CLOSES.getTime() + 60 * 60 * 1000);
    h.clock.set(late);
    await h.as(manager).publishCompetition({ competitionId: id });

    await h.drain();
    await h.drain();

    expect(await publicStatus(h, slug)).toBe("registration_closed");
    expect(
      (await statusChanges(h)).map(({ before, after, occurredAt }) => ({
        before,
        after,
        occurredAt,
      }))
    ).toEqual([
      {
        before: { status: "published" },
        after: {
          status: "registration_open",
          keyDate: "registration_opens",
          at: "2027-02-01T03:30:00.000Z",
        },
        occurredAt: late,
      },
      {
        before: { status: "registration_open" },
        after: {
          status: "registration_closed",
          keyDate: "registration_closes",
          at: "2027-02-20T12:30:00.000Z",
        },
        occurredAt: late,
      },
    ]);
  });

  it("makes every move that is due even when a later date's job runs first", async () => {
    const h = await createHarness();
    const { slug, competitionId } = await publishedCompetition(h);
    h.clock.set(CLOSES);

    expect(
      await h.as(WORKER).advanceCompetitionStatus({
        competitionId,
        kind: "registration_closes",
        dueAt: CLOSES.toISOString(),
      })
    ).toEqual({ ok: true, outcome: "advanced", status: "registration_closed" });
    expect(await publicStatus(h, slug)).toBe("registration_closed");
    expect((await statusChanges(h)).map((change) => change.after)).toEqual([
      expect.objectContaining({ status: "registration_open" }),
      expect.objectContaining({ status: "registration_closed" }),
    ]);

    await h.drain();
    expect(await statusChanges(h)).toHaveLength(2);
  });

  it("saves a job that runs before its instant again, and the instant still moves the status once", async () => {
    const h = await createHarness();
    const { slug, competitionId } = await publishedCompetition(h);
    const job = {
      competitionId,
      kind: "registration_opens",
      dueAt: OPENS.toISOString(),
    } as const;

    expect(await h.as(WORKER).advanceCompetitionStatus(job)).toEqual({
      ok: true,
      outcome: "early",
      status: "published",
    });

    h.clock.set(OPENS);
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");
    expect(await statusChanges(h)).toHaveLength(1);
  });

  it("does nothing with a job for a draft", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const created = await h
      .as(manager)
      .createCompetition(completeFields({ keyDates: KEY_DATES }));
    if (!created.ok) throw new Error(created.error);
    const competitionId = created.competition.id;
    h.clock.set(CLOSES);

    expect(
      await h.as(WORKER).advanceCompetitionStatus({
        competitionId,
        kind: "registration_opens",
        dueAt: OPENS.toISOString(),
      })
    ).toEqual({ ok: true, outcome: "advanced", status: "draft" });
    await h.drain();
    expect(await statusChanges(h)).toEqual([]);
  });

  it("gives a competition manager no way to open or close registration", async () => {
    const h = await createHarness();
    const { manager, slug, competitionId } = await publishedCompetition(h);

    // The form has no status field: a status sent with it is dropped.
    expect(
      await h.as(manager).updateCompetition({
        competitionId,
        status: "registration_open",
      } as UpdateCompetitionInput)
    ).toEqual({ ok: true, changed: false });
    expect(await h.as(manager).publishCompetition({ competitionId })).toEqual({
      ok: false,
      error: "not_draft",
    });
    expect(await publicStatus(h, slug)).toBe("published");
  });
});

describe("the next status change, as the admin page counts down to it", () => {
  async function nextChange(h: Harness, manager: Actor, competitionId: string) {
    const edit = await h.as(manager).getCompetitionForEdit({ competitionId });
    if (!edit.ok) throw new Error(edit.error);
    return edit.competition.nextChange;
  }

  it("names the next move and its instant, says it is due once passed, and moves on after it", async () => {
    const h = await createHarness();
    const { manager, competitionId } = await publishedCompetition(h);

    expect(await nextChange(h, manager, competitionId)).toEqual({
      kind: "scheduled",
      to: "registration_open",
      at: OPENS,
    });

    h.clock.set(OPENS);
    expect(await nextChange(h, manager, competitionId)).toEqual({
      kind: "due",
      to: "registration_open",
      at: OPENS,
    });

    await h.drain();
    expect(await nextChange(h, manager, competitionId)).toEqual({
      kind: "scheduled",
      to: "registration_closed",
      at: CLOSES,
    });

    h.clock.set(CLOSES);
    await h.drain();
    expect(await nextChange(h, manager, competitionId)).toEqual({
      kind: "scheduled",
      to: "school_judging",
      at: new Date("2027-02-28T18:29:00.000Z"),
    });
  });

  it("has none for a draft: publishing comes first", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const created = await h
      .as(manager)
      .createCompetition(completeFields({ keyDates: KEY_DATES }));
    if (!created.ok) throw new Error(created.error);

    expect(await nextChange(h, manager, created.competition.id)).toBeNull();
  });
});

describe("advanceCompetitionStatus: who may", () => {
  it("lets the worker run a status job", async () => {
    const h = await createHarness();
    const { slug, competitionId } = await publishedCompetition(h);
    h.clock.set(OPENS);

    expect(
      await h.as(WORKER).advanceCompetitionStatus({
        competitionId,
        kind: "registration_opens",
        dueAt: OPENS.toISOString(),
      })
    ).toEqual({ ok: true, outcome: "advanced", status: "registration_open" });
    expect(await publicStatus(h, slug)).toBe("registration_open");
  });

  it.each([
    ["the competition's manager", "manager"],
    ["a member", "member"],
    ["a visitor", "visitor"],
    ["the operator's command line", "cli"],
  ] as const)("refuses %s, changing nothing", async (_who, kind) => {
    const h = await createHarness();
    const { manager, slug, competitionId } = await publishedCompetition(h);
    h.clock.set(OPENS);
    const actor: Actor =
      kind === "manager"
        ? manager
        : kind === "member"
          ? await signInWith(h, null)
          : kind === "visitor"
            ? h.visitor()
            : { kind: "system", process: "cli" };

    await expect(
      h.as(actor).advanceCompetitionStatus({
        competitionId,
        kind: "registration_opens",
        dueAt: OPENS.toISOString(),
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await publicStatus(h, slug)).toBe("published");
    expect(await statusChanges(h)).toEqual([]);
  });
});

describe("editing a key date", () => {
  /** Moves registration open to `local` (IST, as the form sends it). */
  async function moveOpening(
    h: Harness,
    manager: Actor,
    competitionId: string,
    local: string
  ) {
    const result = await h.as(manager).updateCompetition({
      competitionId,
      keyDates: { ...KEY_DATES, registration_opens: local },
    });
    expect(result).toEqual({ ok: true, changed: true });
  }

  it("moves the change to the new instant, and the old job does nothing", async () => {
    const h = await createHarness();
    const { manager, slug, competitionId } = await publishedCompetition(h);
    await moveOpening(h, manager, competitionId, "2027-02-02T09:00");

    h.clock.set(OPENS);
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("published");
    expect(await statusChanges(h)).toEqual([]);

    const moved = new Date("2027-02-02T03:30:00.000Z");
    h.clock.set(moved);
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");
    expect((await statusChanges(h)).map((change) => change.after)).toEqual([
      {
        status: "registration_open",
        keyDate: "registration_opens",
        at: "2027-02-02T03:30:00.000Z",
      },
    ]);
  });

  it("opens at an earlier instant it is moved to, and the old job then does nothing", async () => {
    const h = await createHarness();
    const { manager, slug, competitionId } = await publishedCompetition(h);
    await moveOpening(h, manager, competitionId, "2027-01-25T09:00");

    const moved = new Date("2027-01-25T03:30:00.000Z");
    h.clock.set(new Date(moved.getTime() - 1));
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("published");

    h.clock.set(moved);
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");

    h.clock.set(OPENS);
    await h.drain();
    expect(await statusChanges(h)).toHaveLength(1);
  });

  it("never moves the status back when a date that has passed moves ahead", async () => {
    const h = await createHarness();
    const { manager, slug, competitionId } = await publishedCompetition(h);
    h.clock.set(OPENS);
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");

    await moveOpening(h, manager, competitionId, "2027-02-04T09:00");
    expect(await publicStatus(h, slug)).toBe("registration_open");

    h.clock.set(new Date("2027-02-04T03:30:00.000Z"));
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");
    expect(await statusChanges(h)).toHaveLength(1);
  });

  it("closes registration at once when its close moves to an instant already passed", async () => {
    const h = await createHarness();
    const { manager, slug, competitionId } = await publishedCompetition(h);
    h.clock.set(new Date("2027-02-10T00:00:00.000Z"));
    await h.drain();
    expect(await publicStatus(h, slug)).toBe("registration_open");

    const result = await h.as(manager).updateCompetition({
      competitionId,
      keyDates: { ...KEY_DATES, registration_closes: "2027-02-09T18:00" },
    });
    expect(result).toEqual({ ok: true, changed: true });
    await h.drain();

    expect(await publicStatus(h, slug)).toBe("registration_closed");
    expect((await statusChanges(h)).at(-1)?.after).toEqual({
      status: "registration_closed",
      keyDate: "registration_closes",
      at: "2027-02-09T12:30:00.000Z",
    });
  });
});
