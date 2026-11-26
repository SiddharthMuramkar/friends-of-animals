import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { entry, roundResult } from "../../db/schema";
import { SEED_SCORING_COMPETITION } from "../../seed/competitions";
import { SEED_SCORING } from "../../seed/scoring";
import { latestDocument } from "../consent/repository";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});
it("serializes locking against a concurrent score save and preserves the exact locked snapshot", async () => {
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
    name: `Concurrent lock ${randomUUID()}`,
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
  expect(
    await judgeApp.saveScoreSheet({
      ...input,
      baseVersion: 0,
      scores: Object.fromEntries(detail.criteria.map((c) => [c.id, 8])),
    })
  ).toMatchObject({ ok: true, progress: "complete" });
  const races = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from judging_round where id = ${roundId} for update`;
    const lock = staff.lockJudgingRound({ roundId });
    lock.catch(() => {});
    await world.waitForLockWaiters(1);
    const save = judgeApp.saveScoreSheet({
      ...input,
      baseVersion: 1,
      scores: { [detail.criteria[0]!.id]: null },
    });
    save.catch(() => {});
    await world.waitForLockWaiters(2);
    return { lock, save };
  });
  const [locked, saved] = await Promise.all([races.lock, races.save]);
  // Whether lock or clear won the race, the snapshot can never disagree
  // with the persisted score sheet. A refused lock leaves the round open.
  if (locked.ok) {
    expect(saved).toMatchObject({ ok: false, error: "round_locked" });
    expect(await staff.getRoundRankings({ roundId })).toMatchObject({
      ok: true,
      round: { status: "locked" },
      ranked: [{ scoreNumerator: "80", scoreDenominator: "1" }],
    });
  } else {
    expect(locked).toMatchObject({ ok: false, error: "unscored_assignments" });
    expect(saved).toMatchObject({ ok: true, progress: "in_progress" });
    expect(
      await world.db
        .select()
        .from(roundResult)
        .where(eq(roundResult.roundId, roundId))
    ).toEqual([]);
  }
});
