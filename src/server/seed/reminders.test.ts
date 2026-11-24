import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox, reminderJob } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_ENTRY_COMPETITIONS } from "./competitions";

// #84 84b AC11: the preview seed plans the seeded live competitions'
// submission reminders, as publishing would, sends nothing now, and runs
// again safely.

const NEIGH27 = "01938a00-0000-7000-8000-000000002101";
const PUBLISHED = "01938a00-0000-7000-8000-000000002102";

async function planned(h: Awaited<ReturnType<typeof createHarness>>) {
  return h.db
    .select({
      id: reminderJob.id,
      subjectId: reminderJob.subjectId,
      offsetHours: reminderJob.offsetHours,
      status: reminderJob.status,
    })
    .from(reminderJob)
    .orderBy(asc(reminderJob.subjectId), asc(reminderJob.fireAt));
}

describe("the reminders seed", () => {
  it("plans two submission reminders for each live competition with a deadline ahead", async () => {
    const h = await createHarness();

    await h.seed.preview();

    const rows = await planned(h);
    const subjects = [
      NEIGH27,
      PUBLISHED,
      ...SEED_ENTRY_COMPETITIONS.map(({ id }) => id),
    ].toSorted();
    expect(
      rows.map(({ subjectId, offsetHours, status }) => [
        subjectId,
        offsetHours,
        status,
      ])
    ).toEqual(
      subjects.flatMap((id) => [
        [id, 72, "scheduled"],
        [id, 24, "scheduled"],
      ])
    );
    const due = await h.db
      .select({ availableAt: outbox.availableAt })
      .from(outbox)
      .where(eq(outbox.eventType, "reminder.due"));
    expect(due).toHaveLength(rows.length);
    for (const { availableAt } of due) {
      expect(availableAt.getTime()).toBeGreaterThan(h.clock.now().getTime());
    }
  });

  it("is safe to run again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const first = await planned(h);

    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await planned(h)).toEqual(first);
    expect(
      await h.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "reminder.due"))
    ).toHaveLength(first.length);
  });
});
