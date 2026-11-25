import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "@/test/harness";
import {
  auditLog,
  roundResult,
  criterionScore,
  scoreSheet,
  physicalArtwork,
} from "../../db/schema";
import type { Actor } from "../../actor";
import { SEED_COMPETITION_MANAGER } from "../../seed/competitions";
import { SEED_JUDGING } from "../../seed/judging-rounds";
import { scoringWorld } from "./blind-testing";
import { signedInWith, managerOf } from "./testing";

async function score(
  h: Harness,
  actor: Actor,
  roundId: string,
  entryCode: string,
  values: number[]
) {
  const api = h.as(actor);
  const detail = await api.getBlindEntry({ roundId, entryCode });
  if (!detail.ok) throw new Error(detail.error);
  return api.saveScoreSheet({
    roundId,
    entryCode,
    baseVersion: detail.sheet.version,
    scores: Object.fromEntries(
      detail.criteria.map((c, i) => [c.id, values[i]!])
    ),
  });
}
const admin = (h: Harness) =>
  signedInWith(h, { role: "staff_admin", scope: { type: "global" } });

describe("round rankings and lock", () => {
  it("averages pinned weighted complete sheets, breaks a tie by the highest-weight criterion, and freezes the ranking", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    const staff = h.as(w.manager);
    const input = { roundId: w.roundId };
    expect(await staff.getRoundRankings(input)).toMatchObject({
      ok: true,
      ranked: [],
      unscoredCount: 2,
      assignedCount: 2,
    });
    await expect(h.as(w.judge).getRoundRankings(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(h.as(w.judge).lockJudgingRound(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    const wrong = h.as(
      await signedInWith(h, managerOf("01938a00-0000-7000-8000-000000000001"))
    );
    await expect(wrong.getRoundRankings(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await staff.lockJudgingRound(input)).toMatchObject({
      ok: false,
      error: "unscored_assignments",
      unscoredCount: 2,
    });
    expect(
      await score(h, w.judge, w.roundId, w.code, [9, 6, 6, 6])
    ).toMatchObject({ ok: true, progress: "complete" });
    expect(
      await score(h, w.otherJudge, w.roundId, w.otherCode, [7, 7, 7, 6])
    ).toMatchObject({ ok: true, progress: "complete" });
    // 30*9/10 + 25*6/10 + 25*6/10 + 20*6/10 = 69; 30*7/10 + 25*7/10 + 25*7/10 + 20*6/10 = 68. Use 69 for both by a second sheet averaging 70 and 68 on entry two.
    expect(
      await staff.assignEntries({
        roundId: w.roundId,
        judgeUserId: w.judgeUser.id,
        entryIds: [w.otherEntryId],
      })
    ).toMatchObject({ ok: true, assigned: 1 });
    expect(
      await score(h, w.judge, w.roundId, w.otherCode, [7, 7, 7, 7])
    ).toMatchObject({ ok: true, progress: "complete" });
    const original = await h
      .as(w.judge)
      .getBlindEntry({ ...input, entryCode: w.code });
    if (!original.ok) throw new Error(original.error);
    const criterionId = original.criteria[0]!.id;
    const expected = [
      {
        entryId: w.entryId,
        rank: 1,
        scoreNumerator: "69",
        scoreDenominator: "1",
        sheetsCounted: 1,
        decidedBy: null,
      },
      {
        entryId: w.otherEntryId,
        rank: 2,
        scoreNumerator: "69",
        scoreDenominator: "1",
        sheetsCounted: 2,
        decidedBy: { criterionId },
      },
    ];
    expect(await staff.getRoundRankings(input)).toMatchObject({
      ok: true,
      ranked: expected,
      unscoredCount: 0,
      assignedCount: 3,
    });
    // Clearing a criterion after completion invalidates the lock guard even
    // though the first-completion timestamp has already been recorded.
    expect(
      await h.as(w.judge).saveScoreSheet({
        ...input,
        entryCode: w.code,
        baseVersion: original.sheet.version,
        scores: { [criterionId]: null },
      })
    ).toMatchObject({ ok: true, progress: "in_progress" });
    expect(await staff.lockJudgingRound(input)).toMatchObject({
      ok: false,
      error: "unscored_assignments",
      unscoredCount: 1,
    });
    expect(
      await score(h, w.judge, w.roundId, w.code, [9, 6, 6, 6])
    ).toMatchObject({ ok: true, progress: "complete" });
    const tag = {
      entryId: w.entryId,
      outcome: "finalist" as const,
      awardPosition: null,
      suitableForAuction: true,
    };
    expect(
      await staff.tagRoundOutcomes({ ...input, tags: [tag] })
    ).toMatchObject({ ok: false, error: "round_not_locked" });
    expect(await staff.lockJudgingRound(input)).toMatchObject({
      ok: true,
      mode: "complete",
      rankedCount: 2,
    });
    expect(await staff.lockJudgingRound(input)).toMatchObject({
      ok: false,
      error: "round_not_open",
    });
    expect(await staff.getRoundRankings(input)).toMatchObject({
      ok: true,
      ranked: [
        { ...expected[0], outcome: "winner", awardPosition: 1 },
        { ...expected[1], outcome: "runner_up", awardPosition: 2 },
      ],
    });
    expect(
      await h.as(w.judge).saveScoreSheet({
        ...input,
        entryCode: w.code,
        baseVersion: 1,
        comment: "Do not change",
      })
    ).toMatchObject({ ok: false, error: "round_locked" });
    await expect(
      h.as(w.judge).tagRoundOutcomes({ ...input, tags: [tag] })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await staff.tagRoundOutcomes({
        ...input,
        tags: [{ ...tag, awardPosition: 1 }],
      })
    ).toMatchObject({ ok: false, error: "invalid_outcomes" });
    expect(await staff.tagRoundOutcomes({ ...input, tags: [tag] })).toEqual({
      ok: true,
      changed: 1,
    });
    expect(await staff.getRoundRankings(input)).toMatchObject({
      ok: true,
      ranked: [{ ...expected[0], ...tag }, expected[1]],
    });
    expect(
      await h.db.select().from(auditLog).where(eq(auditLog.entityId, w.roundId))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "judging_round.locked" }),
        expect.objectContaining({
          action: "judging_round.outcomes_tagged",
          actorRole: "competition_manager",
        }),
      ])
    );
    // Database invariant: direct attempts can't silently change the locked result or score.
    await expect(
      h.db
        .update(roundResult)
        .set({ rank: 9 })
        .where(eq(roundResult.roundId, w.roundId))
    ).rejects.toThrow();
    await expect(
      h.db
        .update(scoreSheet)
        .set({ comment: "Not permitted" })
        .where(eq(scoreSheet.roundId, w.roundId))
    ).rejects.toThrow();
    await expect(
      h.db.update(criterionScore).set({ value: 1 })
    ).rejects.toThrow();
  });

  it("requires a staff admin's reason for incomplete work and excludes unscored assignments instead of treating them as zero", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    const staff = h.as(w.manager);
    const input = { roundId: w.roundId };
    const override = h.as(await admin(h));
    expect(
      await score(h, w.judge, w.roundId, w.code, [8, 8, 8, 8])
    ).toMatchObject({ ok: true, progress: "complete" });
    await expect(
      staff.lockJudgingRound({ ...input, overrideReason: "Judge unavailable" })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await override.lockJudgingRound({ ...input, overrideReason: " " })
    ).toMatchObject({ ok: false, error: "override_reason_invalid" });
    expect(
      await override.lockJudgingRound({
        ...input,
        overrideReason: "Second judge unavailable",
      })
    ).toMatchObject({ ok: true, mode: "override", rankedCount: 1 });
    expect(await staff.getRoundRankings(input)).toMatchObject({
      ok: true,
      ranked: [{ entryId: w.entryId, scoreNumerator: "80" }],
      unscored: [{ entryId: w.otherEntryId }],
    });
    expect(
      await staff.tagRoundOutcomes({
        ...input,
        tags: [
          {
            entryId: w.otherEntryId,
            outcome: "winner",
            awardPosition: 1,
            suitableForAuction: false,
          },
        ],
      })
    ).toMatchObject({ ok: false, error: "invalid_outcomes" });
    expect(
      await h.db.select().from(auditLog).where(eq(auditLog.entityId, w.roundId))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "judging_round.lock_overridden",
          actorRole: "staff_admin",
          after: expect.objectContaining({
            reason: "Second judge unavailable",
            unscoredAssignmentIds: [expect.stringContaining(w.otherEntryId)],
          }),
        }),
      ])
    );
  });

  it("rechecks a live institution conflict, including a sheet completed before that conflict arose", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    const staff = h.as(w.manager);
    const input = { roundId: w.roundId };
    expect(
      await score(h, w.judge, w.roundId, w.code, [9, 9, 9, 9])
    ).toMatchObject({ ok: true, progress: "complete" });
    expect(
      await score(h, w.otherJudge, w.roundId, w.otherCode, [6, 6, 6, 6])
    ).toMatchObject({ ok: true, progress: "complete" });
    await h.seed.grant(w.judgeUser, {
      role: "institution_coordinator",
      scope: { type: "institution", id: w.school.institutionId },
    });
    expect(await staff.getRoundRankings(input)).toMatchObject({
      ok: true,
      ranked: [{ entryId: w.otherEntryId }],
      unscored: [{ entryId: w.entryId }],
      unscoredCount: 1,
    });
    expect(await staff.lockJudgingRound(input)).toMatchObject({
      ok: false,
      error: "unscored_assignments",
      unscoredCount: 1,
    });
    expect(
      await h.as(await admin(h)).lockJudgingRound({
        ...input,
        overrideReason: "Conflicted assignment disregarded",
      })
    ).toMatchObject({ ok: true, rankedCount: 1 });
  });
});

it("omits physical works that become unavailable after admission, including from locked views", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const staff = h.as(await h.signIn(SEED_COMPETITION_MANAGER));
  const judge = await h.signIn(SEED_JUDGING.onboardedJudge);
  const input = { roundId: SEED_JUDGING.openRoundId };
  const codes = ["ORIG27-E-5EED06", "ORIG27-E-5EED07"];
  for (const code of codes)
    expect(
      await score(h, judge, input.roundId, code, [7, 7, 7, 7])
    ).toMatchObject({ ok: true, progress: "complete" });
  expect(await staff.getRoundRankings(input)).toMatchObject({
    ok: true,
    ranked: expect.arrayContaining(
      codes.map((code) => expect.objectContaining({ code, rank: 1 }))
    ),
    unscored: [],
    unscoredCount: 0,
  });
  const hide = async (code: string) =>
    h.db
      .update(physicalArtwork)
      .set({ status: "returned" })
      .where(eq(physicalArtwork.artworkCode, code));
  // Simulates a changed custody record independent of judging, as #96 does.
  await hide("ORIG27-A-5EED06");
  expect(await staff.getRoundRankings(input)).toMatchObject({
    ok: true,
    ranked: [{ code: codes[1] }],
    unscored: [],
    unscoredCount: 1,
  });
  expect(await staff.getRoundPool(input)).toMatchObject({
    ok: true,
    entries: [{ code: codes[1] }],
  });
  expect(await staff.listAssignments(input)).toMatchObject({
    ok: true,
    assignments: [{ code: codes[1] }],
  });
  expect(await staff.lockJudgingRound(input)).toMatchObject({
    ok: false,
    error: "unscored_assignments",
  });
  expect(
    await h.as(await admin(h)).lockJudgingRound({
      ...input,
      overrideReason: "One original no longer held",
    })
  ).toMatchObject({ ok: true, rankedCount: 1 });
  expect(await staff.getRoundRankings(input)).toMatchObject({
    ok: true,
    ranked: [{ code: codes[1] }],
  });
  await hide("ORIG27-A-5EED07");
  expect(await staff.getRoundRankings(input)).toMatchObject({
    ok: true,
    ranked: [],
    unscored: [],
  });
  expect(await h.as(judge).listMyAssignments(input)).toMatchObject({
    ok: true,
    entries: [],
  });
  expect(
    await h.db
      .select()
      .from(roundResult)
      .where(eq(roundResult.roundId, input.roundId))
  ).toMatchObject([{ code: codes[1] }]);
});

it("does not count a complete sheet after its judge's grant is revoked", async () => {
  const h = await createHarness();
  const w = await scoringWorld(h);
  const staff = h.as(w.manager);
  const input = { roundId: w.roundId };
  expect(
    await score(h, w.judge, w.roundId, w.code, [10, 10, 10, 10])
  ).toMatchObject({ ok: true, progress: "complete" });
  const superAdmin = h.as(
    await signedInWith(h, { role: "super_admin", scope: { type: "global" } })
  );
  expect(
    await superAdmin.revokeRole({
      userId: w.judgeUser.id,
      role: "judge",
      scope: { type: "round", id: w.roundId },
    })
  ).toMatchObject({ ok: true, changed: true });
  expect(await staff.getRoundRankings(input)).toMatchObject({
    ok: true,
    ranked: [],
    unscoredCount: 2,
  });
  expect(await staff.lockJudgingRound(input)).toMatchObject({
    ok: false,
    error: "unscored_assignments",
    unscoredCount: 2,
  });
});
