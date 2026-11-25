import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import {
  competition,
  judgingRound,
  outbox,
  resultRelease,
} from "../../db/schema";
import { TIE_BREAK_RULE } from "../judging/domain/ranking";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});
const worker = { kind: "system", process: "worker" } as const;
async function pending() {
  const c = await world.seed.competition({
    status: "foa_judging",
    code: `RES${Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}27`,
    name: `PG release ${randomUUID()}`,
  });
  const roundId = randomUUID(),
    now = world.clock.now();
  const actor = async (role: "competition_manager" | "super_admin") => {
    const u = await world.seed.member({ email: world.uniqueEmail() });
    await world.seed.grant(u, {
      role,
      scope:
        role === "super_admin"
          ? { type: "global" }
          : { type: "competition", id: c.id },
    });
    await world.seed.authenticator(u);
    return world.as(await world.signedIn(u, { secondFactor: true }));
  };
  // Fixture for an intentionally empty reasoned lock. Release behaviour,
  // not ranking computation, is the race under test.
  await world.db.insert(judgingRound).values({
    id: roundId,
    competitionId: c.id,
    name: "Final",
    nameKey: "final",
    status: "locked",
    lockedAt: now,
    lockOverrideReason: "No complete entries in this category",
    tieBreakRule: TIE_BREAK_RULE,
    createdAt: now,
    updatedAt: now,
  });
  const manager = await actor("competition_manager"),
    reviewer = await actor("competition_manager"),
    admin = await actor("super_admin");
  const prepared = await manager.prepareResultsRelease({
    competitionId: c.id,
    sourceRoundId: roundId,
    publishAt: new Date(now.getTime() + 60_000).toISOString(),
    deliveryNote: "FOA will contact each prize recipient.",
  });
  if (!prepared.ok) throw Error(prepared.error);
  const input = { competitionId: c.id, releaseId: prepared.releaseId };
  expect(await reviewer.approveResultsRelease(input)).toMatchObject({
    ok: true,
  });
  world.clock.advance({ minutes: 1 });
  return { input, admin };
}
it("serializes duplicate scheduled publication and emits exactly one trusted event", async () => {
  const { input } = await pending();
  const api = world.as(worker);
  const calls = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from competition where id = ${input.competitionId} for update`;
    const first = api.publishResultsRelease(input);
    first.catch(() => {});
    await world.waitForLockWaiters(1);
    const second = api.publishResultsRelease(input);
    second.catch(() => {});
    await world.waitForLockWaiters(2);
    return { first, second };
  });
  expect(await Promise.all([calls.first, calls.second])).toEqual(
    expect.arrayContaining([
      { ok: true, outcome: "published" },
      { ok: true, outcome: "ignored" },
    ])
  );
  const events = await world.db
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.aggregateId, input.competitionId),
        eq(outbox.eventType, "results.published")
      )
    );
  expect(new Set(events.map((d) => d.eventId)).size).toBe(1);
  expect(events.map((d) => d.handler)).toEqual(
    expect.arrayContaining([
      "artwork.open_results_window",
      "certificates.issue",
      "community.record_results",
    ])
  );
  expect(events[0]?.payload).toEqual({
    ...input,
    publishedAt: world.clock.now().toISOString(),
  });
});
it("serializes cancellation against publication, never publishing a cancelled competition", async () => {
  const { input, admin } = await pending();
  const api = world.as(worker);
  const calls = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from competition where id = ${input.competitionId} for update`;
    const cancelled = admin.cancelCompetition({
      competitionId: input.competitionId,
      reason: "Cancelled before publication.",
    });
    cancelled.catch(() => {});
    await world.waitForLockWaiters(1);
    const published = api.publishResultsRelease(input);
    published.catch(() => {});
    await world.waitForLockWaiters(2);
    return { cancelled, published };
  });
  const [cancelled, published] = await Promise.all([
    calls.cancelled,
    calls.published,
  ]);
  const [c] = await world.db
    .select()
    .from(competition)
    .where(eq(competition.id, input.competitionId));
  const [release] = await world.db
    .select()
    .from(resultRelease)
    .where(eq(resultRelease.id, input.releaseId));
  const events = await world.db
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.aggregateId, input.competitionId),
        eq(outbox.eventType, "results.published")
      )
    );
  if (cancelled.ok) {
    expect(c?.status).toBe("cancelled");
    expect(release?.status).toBe("rejected");
    expect(published).toMatchObject({ ok: true, outcome: "rejected" });
    expect(events).toHaveLength(0);
  } else {
    expect(cancelled).toMatchObject({ ok: false, error: "results_published" });
    expect(c?.status).toBe("results_published");
    expect(release?.status).toBe("published");
    expect(new Set(events.map((d) => d.eventId)).size).toBe(1);
    expect(events.map((d) => d.handler)).toEqual(
      expect.arrayContaining([
        "artwork.open_results_window",
        "certificates.issue",
        "community.record_results",
      ])
    );
  }
});
