import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { competition } from "../../db/schema";
import { SEED_SCORING_COMPETITION } from "../../seed/competitions";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});

it("serializes competing source edits so they cannot close a loop", async () => {
  await world.seed.preview();
  const competitionId = SEED_SCORING_COMPETITION.id;
  const manager = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(manager, {
    role: "competition_manager",
    scope: { type: "competition", id: competitionId },
  });
  await world.seed.authenticator(manager);
  const staff = world.as(await world.signedIn(manager, { secondFactor: true }));
  const first = await staff.createJudgingRound({
    competitionId,
    name: `First ${randomUUID()}`,
  });
  const second = await staff.createJudgingRound({
    competitionId,
    name: `Second ${randomUUID()}`,
  });
  if (!first.ok || !second.ok) throw new Error("Drafts missing");
  const race = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from competition where id = ${competitionId} for update`;
    const a = staff.updateJudgingRound({
      roundId: first.roundId,
      entrySource: "round_finalists",
      sourceRoundId: second.roundId,
    });
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = staff.updateJudgingRound({
      roundId: second.roundId,
      entrySource: "round_finalists",
      sourceRoundId: first.roundId,
    });
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  const outcomes = await Promise.all([race.a, race.b]);
  expect(outcomes).toEqual(
    expect.arrayContaining([{ ok: true }, { ok: false, error: "chain_cycle" }])
  );
  const results = await staff.listJudgingRounds({ competitionId });
  if (!results.ok) throw new Error(results.error);
  const linked = results.rounds.filter(
    (r) =>
      [first.roundId, second.roundId].includes(r.id) && r.sourceRoundId !== null
  );
  expect(linked).toHaveLength(1);
});

it("round creation and rubric revision share a competition-first lock order", async () => {
  const competitionId = randomUUID();
  const suffix = competitionId.replaceAll("-", "").slice(0, 7).toUpperCase();
  const now = world.clock.now();
  await world.db.insert(competition).values({
    id: competitionId,
    code: `${[...suffix.slice(0, 6)].map((ch) => String.fromCharCode(65 + Number.parseInt(ch, 16))).join("")}98`,
    slug: `round-rubric-race-${suffix.toLowerCase()}`,
    name: "Round pin race",
    status: "published",
    publishedAt: now,
    participation: "both",
    disciplines: ["drawing"],
    createdAt: now,
    updatedAt: now,
  });
  const manager = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(manager, {
    role: "competition_manager",
    scope: { type: "competition", id: competitionId },
  });
  await world.seed.authenticator(manager);
  const staff = world.as(await world.signedIn(manager, { secondFactor: true }));
  const draft = await staff.createRubricDraft({
    competitionId,
    discipline: "drawing",
  });
  if (!draft.ok) throw new Error(draft.error);
  expect(
    await staff.publishRubric({ rubricId: draft.rubric.id })
  ).toMatchObject({ ok: true });
  const pending = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from competition where id = ${competitionId} for update`;
    const create = staff.createJudgingRound({
      competitionId,
      name: "Round pins current rubric",
    });
    create.catch(() => {});
    await world.waitForLockWaiters(1);
    const revise = staff.startRubricRevision({ rubricId: draft.rubric.id });
    revise.catch(() => {});
    await world.waitForLockWaiters(2);
    return { create, revise };
  });
  const [created, revision] = await Promise.all([
    pending.create,
    pending.revise,
  ]);
  expect(revision).toMatchObject({ ok: true });
  if (!created.ok) throw new Error(created.error);
  expect(
    await staff.getJudgingRound({ roundId: created.roundId })
  ).toMatchObject({
    ok: true,
    pins: [{ rubricId: draft.rubric.id, version: 1 }],
  });
});
