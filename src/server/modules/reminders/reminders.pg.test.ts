// Reminders racing on real PostgreSQL (`pnpm test:pg`). Two scheduling runs
// for one competition at once (the hourly sync and the handler after an
// edit) take turns on an advisory lock, so they plan one set of reminders
// between them. Two runs of one reminder at once (a delivery whose lease
// ran out while it was still sending) take turns on its row, and their
// sends are claimed under its id, so each person gets one copy.

import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reminderJob } from "@/server/db/schema";
import { instantToIstLocal } from "@/server/modules/competitions/domain/ist";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { formatIsoDate } from "@/server/modules/registration/domain/calendar-date";
import { bornYearsAgo } from "@/server/seed/guardians";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { WORKER } from "./testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

const DAY = 24 * 60 * 60 * 1000;

/** An IST key date `days` from the world's now. */
function inDays(days: number): string {
  return instantToIstLocal(new Date(world.clock.now().getTime() + days * DAY));
}

/** A free competition whose submissions close in ten days, its own code. */
function openCompetition() {
  const letters = Array.from({ length: 5 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  const code = `${letters}27`;
  return openToIndividuals(world, {
    fee: 0n,
    code,
    name: `Reminder race ${code}`,
    ageGroups: [{ label: "Everyone", minAge: 5, maxAge: 99 }],
    keyDates: {
      registration_opens: inDays(-1),
      registration_closes: inDays(5),
      submissions_close: inDays(10),
      school_round_closes: inDays(20),
    },
  });
}

async function confirmedAdult(
  competition: Awaited<ReturnType<typeof openCompetition>>
) {
  const email = world.uniqueEmail();
  const account = await world.seed.member({ name: "Asha Rao", email });
  const actor = world.as(await world.signedIn(account));
  const registered = await actor.registerAsIndividual(
    adultForm(competition, {
      fullName: "Asha Rao",
      dateOfBirth: formatIsoDate(bornYearsAgo(world.clock.now(), 30, 0)),
    })
  );
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const paid = await actor.payForMyRegistration({
    registrationId: registered.registrationId,
  });
  if (!paid.ok) throw new Error(JSON.stringify(paid));
  return email;
}

function rowsOf(competitionId: string) {
  return world.db
    .select()
    .from(reminderJob)
    .where(eq(reminderJob.subjectId, competitionId));
}

describe("reminders under concurrency", () => {
  it("plans one set of reminders when two scheduling runs meet", async () => {
    const competition = await openCompetition();
    const worker = world.as(WORKER);
    const input = {
      subjectType: "competition",
      subjectId: competition.id,
    } as const;
    const scope = `reminders:entry_submission_due:${competition.id}`;

    const { first, second } = await world.sql.begin(async (blocker) => {
      await blocker`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
      const first = worker.scheduleReminders(input);
      first.catch(() => {});
      const second = worker.scheduleReminders(input);
      second.catch(() => {});
      await world.waitForLockWaiters(2);
      return { first, second };
    });

    const results = await Promise.all([first, second]);
    expect(
      results
        .map((result) => (result.ok ? result.scheduled : -1))
        .toSorted((a, b) => a - b)
    ).toEqual([0, 2]);
    expect(await rowsOf(competition.id)).toHaveLength(2);
  });

  it("sends each person one copy when two runs of a reminder meet", async () => {
    const competition = await openCompetition();
    const emails = [
      await confirmedAdult(competition),
      await confirmedAdult(competition),
    ];
    const worker = world.as(WORKER);
    await worker.scheduleReminders({
      subjectType: "competition",
      subjectId: competition.id,
    });
    const [first] = (await rowsOf(competition.id)).toSorted(
      (a, b) => a.fireAt.getTime() - b.fireAt.getTime()
    );
    world.clock.set(first!.fireAt);

    const { runs } = await world.sql.begin(async (blocker) => {
      await blocker`select id from reminder_job where id = ${first!.id} for update`;
      const runs = [
        worker.runReminder({ reminderJobId: first!.id }),
        worker.runReminder({ reminderJobId: first!.id }),
      ];
      for (const run of runs) run.catch(() => {});
      await world.waitForLockWaiters(2);
      return { runs };
    });
    const settled = await Promise.allSettled(runs);
    // A run that met the other's claim mid-send fails, for the relay to
    // retry; that retry sends nothing more.
    await worker.runReminder({ reminderJobId: first!.id });

    expect(settled.some((run) => run.status === "fulfilled")).toBe(true);
    const sent = world.deps.email.sent.filter((message) =>
      emails.includes(message.to)
    );
    expect(sent.map((message) => message.to).toSorted()).toEqual(
      emails.toSorted()
    );
    const [fired] = await world.db
      .select({ status: reminderJob.status })
      .from(reminderJob)
      .where(eq(reminderJob.id, first!.id));
    expect(fired?.status).toBe("fired");
  });
});
