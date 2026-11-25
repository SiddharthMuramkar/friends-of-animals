import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { judgingRound, judgeInvitation, judgeOnboarding } from "../db/schema";
import { SEED_JUDGING } from "./judging-rounds";
import { SEED_COMPETITION_MANAGER } from "./competitions";
describe("judging round seeds", () => {
  it("seeds pilot rounds, a waiting global continuation and both stages of judge onboarding idempotently", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const manager = h.as(await h.signIn(SEED_COMPETITION_MANAGER));
    expect(
      await manager.getJudgingRound({ roundId: SEED_JUDGING.draftRoundId })
    ).toMatchObject({
      ok: true,
      round: {
        status: "draft",
        level: "national",
        judgesPhysical: true,
        awardScheme: "ranked_123",
      },
    });
    expect(
      await manager.getJudgingRound({ roundId: SEED_JUDGING.openRoundId })
    ).toMatchObject({ ok: true, round: { status: "open" } });
    expect(
      await manager.getJudgingRound({
        roundId: SEED_JUDGING.continuationRoundId,
      })
    ).toMatchObject({
      ok: true,
      round: {
        status: "draft",
        level: "global",
        judgesPhysical: false,
        entrySource: "round_finalists",
        sourceRoundId: SEED_JUDGING.openRoundId,
      },
    });
    expect(
      await manager.admitToPool({ roundId: SEED_JUDGING.continuationRoundId })
    ).toMatchObject({ ok: false, error: "source_not_locked" });
    expect(
      await h.as(await h.signIn(SEED_JUDGING.onboardedJudge)).myJudgeRounds()
    ).toMatchObject({ ok: true, rounds: [{ readiness: { ready: true } }] });
    expect(
      await h.as(await h.signIn(SEED_JUDGING.pendingJudge)).myJudgeRounds()
    ).toMatchObject({ ok: true, rounds: [{ readiness: { ready: false } }] });
    expect(
      await manager.getRoundPool({ roundId: SEED_JUDGING.openRoundId })
    ).toMatchObject({
      ok: true,
      entries: expect.arrayContaining([
        expect.objectContaining({ entryId: expect.any(String) }),
      ]),
    });
    expect(
      await manager.listAssignments({ roundId: SEED_JUDGING.openRoundId })
    ).toMatchObject({
      ok: true,
      assignments: expect.arrayContaining([
        expect.objectContaining({ entryId: expect.any(String) }),
      ]),
    });
    const first = [
      await h.db.select().from(judgingRound),
      await h.db.select().from(judgeInvitation),
      await h.db.select().from(judgeOnboarding),
    ];
    h.clock.advance({ days: 1 });
    await h.seed.preview();
    expect([
      await h.db.select().from(judgingRound),
      await h.db.select().from(judgeInvitation),
      await h.db.select().from(judgeOnboarding),
    ]).toEqual(first);
  });
});
