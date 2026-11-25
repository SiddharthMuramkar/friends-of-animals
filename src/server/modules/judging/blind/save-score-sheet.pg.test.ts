import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { entry, scoreSheet } from "../../../db/schema";
import { SEED_SCORING_COMPETITION } from "../../../seed/competitions";
import { SEED_SCORING } from "../../../seed/scoring";
import { latestDocument } from "../../consent/repository";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});
it("serializes concurrent saves without losing disjoint fields or silently overwriting a same-field edit", async () => {
  await world.seed.preview();
  const comp = SEED_SCORING_COMPETITION.id;
  const manager = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(manager, {
    role: "competition_manager",
    scope: { type: "competition", id: comp },
  });
  await world.seed.authenticator(manager);
  const staff = world.as(await world.signedIn(manager, { secondFactor: true }));
  const created = await staff.createJudgingRound({
    competitionId: comp,
    name: `Concurrent scoring ${randomUUID()}`,
    judgesPhysical: false,
  });
  if (!created.ok) throw new Error(created.error);
  const roundId = created.roundId;
  const entryCode = SEED_SCORING.entryCodes[0];
  const [work] = await world.db
    .select({ id: entry.id })
    .from(entry)
    .where(eq(entry.code, entryCode));
  if (!work) throw new Error("Missing scoring preview work");
  expect(
    await staff.admitToPool({ roundId, entryIds: [work.id] })
  ).toMatchObject({ ok: true, admitted: 1 });
  const judge = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(judge, {
    role: "judge",
    scope: { type: "round", id: roundId },
  });
  const judgeApp = world.as(await world.signedIn(judge));
  const conduct = await latestDocument(world.db, "judge_conduct"),
    confidentiality = await latestDocument(world.db, "judge_confidentiality");
  expect(
    await judgeApp.acceptJudgeTerms({
      roundId,
      conductDocumentId: conduct!.id,
      confidentialityDocumentId: confidentiality!.id,
    })
  ).toMatchObject({ ok: true });
  expect(
    await judgeApp.declareConflicts({ roundId, declaration: { none: true } })
  ).toMatchObject({ ok: true });
  expect(
    await staff.assignEntries({
      roundId,
      judgeUserId: judge.id,
      entryIds: [work.id],
    })
  ).toMatchObject({ ok: true, assigned: 1 });
  expect(await staff.openJudgingRound({ roundId })).toMatchObject({ ok: true });
  const input = { roundId, entryCode };
  const detail = await judgeApp.getBlindEntry(input);
  if (!detail.ok) throw new Error(detail.error);
  const [first, second] = detail.criteria;
  if (!first || !second) throw new Error("Need two criteria");
  const races = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from judging_round where id = ${roundId} for update`;
    const a = judgeApp.saveScoreSheet({
      ...input,
      baseVersion: 0,
      scores: { [first.id]: 7 },
    });
    a.catch(() => {});
    const b = judgeApp.saveScoreSheet({
      ...input,
      baseVersion: 0,
      scores: { [second.id]: 8 },
    });
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  expect(await Promise.all([races.a, races.b])).toMatchObject([
    { ok: true, conflicts: [] },
    { ok: true, conflicts: [] },
  ]);
  expect(await judgeApp.getBlindEntry(input)).toMatchObject({
    ok: true,
    sheet: {
      version: 2,
      scores: { [first.id]: { value: 7 }, [second.id]: { value: 8 } },
    },
  });
  expect(
    await world.db
      .select()
      .from(scoreSheet)
      .where(eq(scoreSheet.roundId, roundId))
  ).toHaveLength(1);
  const collisions = await Promise.all([
    judgeApp.saveScoreSheet({
      ...input,
      baseVersion: 2,
      scores: { [first.id]: 5 },
    }),
    judgeApp.saveScoreSheet({
      ...input,
      baseVersion: 2,
      scores: { [first.id]: 6 },
    }),
  ]);
  expect(collisions.every((r) => r.ok)).toBe(true);
  expect(collisions.flatMap((r) => (r.ok ? r.conflicts : []))).toHaveLength(1);
});
