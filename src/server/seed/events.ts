// Synthetic event examples; existing rows are never reset at reseed.
// The two full check-in workshops are separate for desktop/mobile journeys.
import { eq } from "drizzle-orm";
import { event, eventRegistration, user, type EventRow } from "../db/schema";
import { uuidv7 } from "../ids";
import { recordEngagement } from "../modules/community";
import { emit } from "../outbox";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps, Seeder } from "./types";

import { SEED_EVENTS } from "./event-fixtures";
export { SEED_EVENTS } from "./event-fixtures";

export function eventBuilder(deps: SeedDeps) {
  return async (overrides: Partial<typeof event.$inferInsert> = {}) => {
    const now = deps.clock.now();
    const id = overrides.id ?? uuidv7(now);
    const data: typeof event.$inferInsert = {
      id,
      slug: `event-${id}`,
      kind: "event",
      status: "draft",
      title: "A compassion workshop",
      summary: "Learn to help animals in your neighbourhood.",
      description: "Bring a notebook and water.",
      startsAt: new Date(+now + 72 * 3600_000),
      endsAt: new Date(+now + 74 * 3600_000),
      venueName: "Community Hall",
      address: "Public Park Road",
      city: "Pune",
      pinCode: "411001",
      onlineUrl: null,
      capacity: 2,
      audience: "members",
      registrationOpensAt: null,
      registrationClosesAt: null,
      waitlistEnabled: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    if (data.status === "published" || data.status === "completed")
      data.publishedAt ??= now;
    if (data.status === "completed") data.completedAt ??= data.endsAt;
    if (data.status === "cancelled") data.cancelledAt ??= now;
    const [made] = await deps.db
      .insert(event)
      .values(data)
      .onConflictDoNothing()
      .returning();
    if (!made) {
      const [existing] = await deps.db
        .select()
        .from(event)
        .where(eq(event.id, id));
      if (!existing) throw Error("Seed event slug is already taken");
      return { row: existing, created: false } as const;
    }
    return { row: made, created: true } as const;
  };
}

export const seedEvents: Seeder = async (deps) => {
  const now = deps.clock.now();
  const insert = eventBuilder(deps);
  const fullRows: EventRow[] = [];
  for (const fixture of [SEED_EVENTS.full, SEED_EVENTS.mobile]) {
    const { row, created } = await insert({
      ...fixture,
      status: "published",
      startsAt: new Date(+now + 90 * 60_000),
      endsAt: new Date(+now + 4 * 3600_000),
      audience: "signed_in",
    });
    if (created) fullRows.push(row);
  }
  const campaign = await insert({
    ...SEED_EVENTS.campaign,
    status: "published",
    kind: "campaign",
    venueName: null,
    address: null,
    city: null,
    pinCode: null,
    summary: "Place clean water bowls for animals during warm weather.",
    description: "Learn how to keep bowls clean, safe and filled.",
    capacity: null,
    waitlistEnabled: false,
  });
  await insert(SEED_EVENTS.draft);
  const past = await insert({
    ...SEED_EVENTS.past,
    status: "completed",
    startsAt: new Date(+now - 7 * 24 * 3600_000),
    endsAt: new Date(+now - 7 * 24 * 3600_000 + 2 * 3600_000),
    publishedAt: new Date(+now - 14 * 24 * 3600_000),
  });
  const seedActor = { kind: "system", process: "seed" } as const;
  for (const row of [
    ...fullRows,
    ...(campaign.created ? [campaign.row] : []),
  ]) {
    await emit(
      deps.db,
      deps.clock,
      {
        type: "event.end_due",
        aggregate: { type: "event", id: row.id },
        payload: { eventId: row.id, endsAt: row.endsAt.toISOString() },
      },
      { availableAt: row.endsAt }
    );
  }
  for (const row of fullRows) {
    for (const account of SEED_ACCOUNTS.members.slice(1)) {
      if (
        !(
          await deps.db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, account.id))
        ).length
      )
        continue;
      await deps.db.insert(eventRegistration).values({
        id: uuidv7(now),
        eventId: row.id,
        subjectUserId: account.id,
        registeredByUserId: account.id,
        status: "registered",
        registeredAt: now,
        updatedAt: now,
      });
    }
  }
  if (past.created) {
    for (const [index, account] of SEED_ACCOUNTS.members
      .slice(0, 2)
      .entries()) {
      if (
        !(
          await deps.db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, account.id))
        ).length
      )
        continue;
      const id = uuidv7(now),
        attended = index === 0;
      await deps.db.insert(eventRegistration).values({
        id,
        eventId: past.row.id,
        subjectUserId: account.id,
        registeredByUserId: account.id,
        status: attended ? "checked_in" : "no_show",
        registeredAt: past.row.publishedAt!,
        checkedInAt: attended ? past.row.startsAt : null,
        updatedAt: past.row.endsAt,
      });
      if (attended)
        await recordEngagement(
          deps.db,
          { clock: deps.clock, actor: seedActor },
          {
            type: "entry",
            subject: { kind: "user", userId: account.id },
            kind: "event.attended",
            occurredAt: past.row.startsAt,
            sourceKey: `event_registration:${id}:attended`,
            refType: "event",
            refId: past.row.id,
          }
        );
    }
  }
};
