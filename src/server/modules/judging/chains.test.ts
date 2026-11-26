import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { physicalArtwork } from "../../db/schema";
import { SEED_COMPETITION_MANAGER } from "../../seed/competitions";
import { SEED_JUDGING } from "../../seed/judging-rounds";
import { createHarness } from "@/test/harness";
import { latestDocument } from "../consent/repository";
import { scoringWorld } from "./blind-testing";
import { managerOf, seedCompetition, signedInWith } from "./testing";

describe("judging round sources", () => {
  it("configures draft chains within one competition, refusing invalid sources and loops", async () => {
    const h = await createHarness();
    const c = await seedCompetition(h, { disciplines: ["drawing"] });
    const other = await seedCompetition(h, { disciplines: ["drawing"] });
    const staff = h.as(
      await signedInWith(h, managerOf(c.id), managerOf(other.id))
    );
    for (const competitionId of [c.id, other.id]) {
      const draft = await staff.createRubricDraft({
        competitionId,
        discipline: "drawing",
      });
      if (!draft.ok) throw new Error(draft.error);
      expect(
        await staff.publishRubric({ rubricId: draft.rubric.id })
      ).toMatchObject({ ok: true });
    }
    const city = await staff.createJudgingRound({
      competitionId: c.id,
      name: "City",
      level: "city_district",
      judgesPhysical: false,
    });
    const foreign = await staff.createJudgingRound({
      competitionId: other.id,
      name: "Other",
    });
    if (!city.ok || !foreign.ok) throw new Error("Missing source rounds");
    const state = await staff.createJudgingRound({
      competitionId: c.id,
      name: "State",
      level: "state",
      entrySource: "round_finalists",
      sourceRoundId: city.roundId,
    });
    if (!state.ok) throw new Error(state.error);
    expect(
      await staff.getJudgingRound({ roundId: state.roundId })
    ).toMatchObject({
      ok: true,
      round: { entrySource: "round_finalists", sourceRoundId: city.roundId },
    });
    const setSource = (roundId: string, sourceRoundId: string) =>
      staff.updateJudgingRound({
        roundId,
        entrySource: "round_finalists",
        sourceRoundId,
      });
    expect(await setSource(city.roundId, city.roundId)).toMatchObject({
      ok: false,
      error: "source_is_self",
    });
    const global = await staff.createJudgingRound({
      competitionId: c.id,
      name: "Global",
      level: "global",
      entrySource: "round_finalists",
      sourceRoundId: state.roundId,
    });
    if (!global.ok) throw new Error(global.error);
    expect(await setSource(city.roundId, global.roundId)).toMatchObject({
      ok: false,
      error: "chain_cycle",
    });
    expect(await setSource(city.roundId, state.roundId)).toMatchObject({
      ok: false,
      error: "chain_cycle",
    });
    expect(
      await staff.createJudgingRound({
        competitionId: c.id,
        name: "Wrong source",
        entrySource: "round_finalists",
        sourceRoundId: foreign.roundId,
      })
    ).toMatchObject({ ok: false, error: "source_not_found" });
    expect(await setSource(state.roundId, foreign.roundId)).toMatchObject({
      ok: false,
      error: "source_not_found",
    });
    expect(
      await staff.updateJudgingRound({
        roundId: state.roundId,
        entrySource: "verified_entries",
      })
    ).toMatchObject({ ok: true });
    expect(
      await staff.getJudgingRound({ roundId: state.roundId })
    ).toMatchObject({
      ok: true,
      round: { entrySource: "verified_entries", sourceRoundId: null },
    });
    expect(
      await staff.cancelJudgingRound({
        roundId: city.roundId,
        reason: "No city round",
      })
    ).toMatchObject({ ok: true });
    expect(await setSource(state.roundId, city.roundId)).toMatchObject({
      ok: false,
      error: "source_cancelled",
    });
    const outsider = h.as(await signedInWith(h, managerOf(other.id)));
    await expect(
      outsider.updateJudgingRound({
        roundId: state.roundId,
        entrySource: "round_finalists",
        sourceRoundId: foreign.roundId,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      outsider.createJudgingRound({
        competitionId: c.id,
        name: "Wrong scope",
        entrySource: "round_finalists",
        sourceRoundId: foreign.roundId,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

it("admits only locked advancing outcomes, rechecks readiness, and scores the next round independently", async () => {
  const h = await createHarness();
  const w = await scoringWorld(h);
  const staff = h.as(w.manager);
  const source = { roundId: w.roundId };
  const createNext = (name: string, judgesPhysical: boolean) =>
    staff.createJudgingRound({
      competitionId: w.school.competition.id,
      name,
      level: "global",
      judgesPhysical,
      awardScheme: "grades_ab",
      entrySource: "round_finalists",
      sourceRoundId: w.roundId,
    });
  const next = await createNext("Global", false);
  const physical = await createNext("Physical next", true);
  if (!next.ok || !physical.ok) throw new Error("Missing downstream rounds");
  const target = { roundId: next.roundId };
  expect(await staff.getRoundPool(target)).toMatchObject({
    ok: true,
    entries: [],
    source: { status: "open", advancingCount: 0 },
  });
  expect(await staff.admitToPool(target)).toMatchObject({
    ok: false,
    error: "source_not_locked",
  });
  expect(await staff.openJudgingRound(target)).toMatchObject({
    ok: false,
    error: "source_not_locked",
  });
  await expect(h.as(w.judge).admitToPool(target)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(h.as(w.judge).getRoundPool(target)).rejects.toMatchObject({
    code: "forbidden",
  });
  for (const [actor, code, value] of [
    [w.judge, w.code, 8],
    [w.otherJudge, w.otherCode, 6],
  ] as const) {
    const judge = h.as(actor);
    const detail = await judge.getBlindEntry({ ...source, entryCode: code });
    if (!detail.ok) throw new Error(detail.error);
    expect(
      await judge.saveScoreSheet({
        ...source,
        entryCode: code,
        baseVersion: 0,
        scores: Object.fromEntries(detail.criteria.map((c) => [c.id, value])),
      })
    ).toMatchObject({ ok: true, progress: "complete" });
  }
  expect(await staff.lockJudgingRound(source)).toMatchObject({
    ok: true,
    rankedCount: 2,
  });
  const tag = (
    entryId: string,
    outcome: "finalist" | "special_mention" | "none"
  ) => ({ entryId, outcome, awardPosition: null, suitableForAuction: false });
  expect(
    await staff.tagRoundOutcomes({
      ...source,
      tags: [
        tag(w.entryId, "finalist"),
        tag(w.otherEntryId, "special_mention"),
      ],
    })
  ).toMatchObject({ ok: true, changed: 2 });
  expect(await staff.getRoundPool(target)).toMatchObject({
    ok: true,
    entries: [],
    source: { status: "locked", advancingCount: 1 },
  });
  expect(await staff.admitToPool({ roundId: physical.roundId })).toEqual({
    ok: true,
    admitted: 0,
    alreadyAdmitted: 0,
    refused: [{ entryId: w.entryId, reason: "not_physically_ready" }],
  });
  expect(
    await staff.admitToPool({
      ...target,
      entryIds: [w.entryId, w.entryId, w.otherEntryId],
    })
  ).toEqual({
    ok: true,
    admitted: 1,
    alreadyAdmitted: 0,
    refused: [{ entryId: w.otherEntryId, reason: "not_source_finalist" }],
  });
  expect(await staff.admitToPool(target)).toMatchObject({
    ok: true,
    admitted: 0,
    alreadyAdmitted: 1,
    refused: [],
  });
  // A later outcome save updates availability. Already admitted finalists
  // cannot be retroactively unrecognised while their next round is live.
  expect(
    await staff.tagRoundOutcomes({ ...source, tags: [tag(w.entryId, "none")] })
  ).toMatchObject({ ok: false, error: "outcome_already_advanced" });
  expect(
    await staff.tagRoundOutcomes({
      ...source,
      tags: [tag(w.otherEntryId, "finalist")],
    })
  ).toMatchObject({ ok: true });
  expect(await staff.admitToPool(target)).toMatchObject({
    ok: true,
    admitted: 1,
    alreadyAdmitted: 1,
  });
  expect(
    await staff.updateJudgingRound({
      ...target,
      entrySource: "verified_entries",
    })
  ).toMatchObject({ ok: false, error: "pool_not_empty" });
  expect(await staff.listAssignments(target)).toMatchObject({
    ok: true,
    assignments: [],
  });
  expect(
    await staff.assignEntries({
      ...target,
      judgeUserId: w.judgeUser.id,
      entryIds: [w.entryId],
    })
  ).toMatchObject({ ok: false, error: "judge_not_ready" });
  expect(await staff.openJudgingRound(target)).toMatchObject({ ok: true });
  expect(await staff.getRoundRankings(target)).toMatchObject({
    ok: true,
    ranked: [],
    round: { awardScheme: "grades_ab" },
  });
  const nextJudge = await h.seed.member();
  await h.seed.grant(nextJudge, {
    role: "judge",
    scope: { type: "round", id: next.roundId },
  });
  const judge = h.as(await h.signIn(nextJudge));
  const conduct = await latestDocument(h.db, "judge_conduct");
  const confidentiality = await latestDocument(h.db, "judge_confidentiality");
  expect(
    await judge.acceptJudgeTerms({
      ...target,
      conductDocumentId: conduct!.id,
      confidentialityDocumentId: confidentiality!.id,
    })
  ).toMatchObject({ ok: true });
  expect(
    await judge.declareConflicts({ ...target, declaration: { none: true } })
  ).toMatchObject({ ok: true });
  expect(
    await staff.assignEntries({
      ...target,
      judgeUserId: nextJudge.id,
      entryIds: [w.entryId],
    })
  ).toMatchObject({ ok: true, assigned: 1 });
  const detail = await judge.getBlindEntry({ ...target, entryCode: w.code });
  if (!detail.ok) throw new Error(detail.error);
  expect(detail.sheet).toMatchObject({ version: 0 });
  expect(
    await judge.saveScoreSheet({
      ...target,
      entryCode: w.code,
      baseVersion: 0,
      scores: Object.fromEntries(detail.criteria.map((c) => [c.id, 4])),
    })
  ).toMatchObject({ ok: true, progress: "complete" });
  expect(await staff.getRoundRankings(target)).toMatchObject({
    ok: true,
    ranked: [{ entryId: w.entryId, scoreNumerator: "40" }],
  });
  expect(await staff.getRoundRankings(source)).toMatchObject({
    ok: true,
    ranked: expect.arrayContaining(
      [
        {
          entryId: w.entryId,
          scoreNumerator: "80",
          outcome: "finalist",
          rank: expect.any(Number),
        },
      ].map((r) => expect.objectContaining(r))
    ),
  });
});

it("a later physical round admits only originals still ready, while a digital continuation uses the locked advancement", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const staff = h.as(await h.signIn(SEED_COMPETITION_MANAGER));
  const judge = h.as(await h.signIn(SEED_JUDGING.onboardedJudge));
  const source = { roundId: SEED_JUDGING.openRoundId };
  const pool = await staff.getRoundPool(source);
  if (!pool.ok) throw new Error(pool.error);
  expect(pool.entries).toHaveLength(2);
  for (const { code } of pool.entries) {
    const detail = await judge.getBlindEntry({ ...source, entryCode: code });
    if (!detail.ok) throw new Error(detail.error);
    expect(
      await judge.saveScoreSheet({
        ...source,
        entryCode: code,
        baseVersion: 0,
        scores: Object.fromEntries(detail.criteria.map((c) => [c.id, 7])),
      })
    ).toMatchObject({ ok: true, progress: "complete" });
  }
  expect(await staff.lockJudgingRound(source)).toMatchObject({
    ok: true,
    rankedCount: 2,
  });
  const previous = await staff.getJudgingRound(source);
  if (!previous.ok) throw new Error(previous.error);
  const next = await staff.createJudgingRound({
    competitionId: previous.round.competitionId,
    name: "Physical global",
    level: "global",
    entrySource: "round_finalists",
    sourceRoundId: source.roundId,
  });
  if (!next.ok) throw new Error(next.error);
  const [returned, held] = pool.entries;
  // Independent custody fixture: the original was ready at source lock but is
  // no longer held at admission to the next judging level.
  await h.db
    .update(physicalArtwork)
    .set({ status: "returned" })
    .where(eq(physicalArtwork.entryId, returned!.entryId));
  expect(await staff.admitToPool({ roundId: next.roundId })).toEqual({
    ok: true,
    admitted: 1,
    alreadyAdmitted: 0,
    refused: [{ entryId: returned!.entryId, reason: "not_physically_ready" }],
  });
  expect(await staff.getRoundPool({ roundId: next.roundId })).toMatchObject({
    ok: true,
    entries: [{ entryId: held!.entryId }],
  });
  expect(
    await staff.admitToPool({ roundId: SEED_JUDGING.continuationRoundId })
  ).toEqual({ ok: true, admitted: 2, alreadyAdmitted: 0, refused: [] });
});
