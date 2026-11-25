import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  auditLog,
  scoreSheet,
  criterionScore,
  judgingRound,
} from "../../../db/schema";
import { scoringWorld } from "../blind-testing";

describe("saveScoreSheet", () => {
  it("persists partial and complete sheets, rejects bad scores atomically, and audits only completion and later changes", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    const as = h.as(w.judge);
    const input = { roundId: w.roundId, entryCode: w.code };
    const detail = await as.getBlindEntry(input);
    if (!detail.ok) throw new Error(detail.error);
    const [first, second, ...remaining] = detail.criteria;
    if (!first || !second) throw new Error("Fixture needs two criteria");
    for (const [value, code] of [
      [11, "out_of_range"],
      [-1, "out_of_range"],
      [7.5, "not_an_integer"],
    ] as const) {
      expect(
        await as.saveScoreSheet({
          ...input,
          baseVersion: 0,
          scores: { [first.id]: value },
          comment: "Should not save",
        })
      ).toMatchObject({
        ok: false,
        problems: [{ code, criterionId: first.id }],
      });
    }
    expect(
      await as.saveScoreSheet({
        ...input,
        baseVersion: 0,
        scores: { unknown: 7 },
      })
    ).toMatchObject({
      ok: false,
      problems: [{ code: "unknown_criterion", criterionId: "unknown" }],
    });
    expect(await as.getBlindEntry(input)).toMatchObject({
      ok: true,
      sheet: { version: 0, scores: {}, comment: { text: "" } },
    });
    const partial = await as.saveScoreSheet({
      ...input,
      baseVersion: 0,
      scores: { [first.id]: 7 },
      comment: "Thoughtful composition",
    });
    expect(partial).toMatchObject({
      ok: true,
      progress: "in_progress",
      sheet: {
        version: 1,
        scores: { [first.id]: { value: 7 } },
        comment: { text: "Thoughtful composition" },
      },
    });
    h.clock.advance({ minutes: 30 });
    expect(await h.as(w.judge).getBlindEntry(input)).toMatchObject({
      ok: true,
      progress: "in_progress",
      sheet: {
        version: 1,
        scores: { [first.id]: { value: 7 } },
        comment: { text: "Thoughtful composition" },
      },
    });
    expect(await as.listMyAssignments({ roundId: w.roundId })).toMatchObject({
      ok: true,
      entries: [{ progress: "in_progress" }],
    });
    const [row] = await h.db.select().from(scoreSheet);
    expect(row?.complete).toBe(false);
    const audit = () =>
      h.db.select().from(auditLog).where(eq(auditLog.entityId, row!.id));
    expect(await audit()).toEqual([]);
    // Stale version 0 changes a different field: both survive.
    expect(
      await as.saveScoreSheet({
        ...input,
        baseVersion: 0,
        scores: { [second.id]: 8 },
      })
    ).toMatchObject({
      ok: true,
      sheet: {
        version: 2,
        scores: { [first.id]: { value: 7 }, [second.id]: { value: 8 } },
      },
      conflicts: [],
    });
    // A stale same-field write is reported, not silently applied.
    expect(
      await as.saveScoreSheet({
        ...input,
        baseVersion: 0,
        scores: { [first.id]: 5 },
        comment: "Other window",
      })
    ).toMatchObject({
      ok: true,
      sheet: { version: 2 },
      conflicts: [
        { field: "score", criterionId: first.id, current: 7 },
        { field: "comment", current: "Thoughtful composition" },
      ],
    });
    expect(
      await as.saveScoreSheet({
        ...input,
        baseVersion: 2,
        scores: Object.fromEntries(remaining.map((c) => [c.id, 6])),
      })
    ).toMatchObject({ ok: true, progress: "complete", sheet: { version: 3 } });
    expect(await as.listMyAssignments({ roundId: w.roundId })).toMatchObject({
      ok: true,
      entries: [{ progress: "complete" }],
    });
    expect(await h.db.select().from(scoreSheet)).toMatchObject([
      { complete: true, completedAt: h.clock.now() },
    ]);
    expect((await audit()).map((a) => a.action)).toEqual([
      "score_sheet.completed",
    ]);
    expect(
      await as.saveScoreSheet({
        ...input,
        baseVersion: 3,
        scores: { [first.id]: null },
      })
    ).toMatchObject({
      ok: true,
      progress: "in_progress",
      sheet: { version: 4 },
    });
    expect((await audit()).map((a) => a.action)).toEqual([
      "score_sheet.completed",
      "score_sheet.changed",
    ]);
    expect(await h.db.select().from(scoreSheet)).toMatchObject([
      { complete: false, completedAt: h.clock.now() },
    ]);
    expect(
      await as.saveScoreSheet({
        ...input,
        baseVersion: 3,
        scores: { [first.id]: 9 },
      })
    ).toMatchObject({
      ok: true,
      conflicts: [{ field: "score", criterionId: first.id, current: null }],
    });
    // Unassigning a now-conflicted judge removes all scores. No stale score
    // can enter the next round's rankings; completion audit remains.
    expect(
      await h.as(w.manager).flagConflict({
        roundId: w.roundId,
        judgeUserId: w.judgeUser.id,
        entryId: w.entryId,
      })
    ).toMatchObject({ ok: true });
    expect(await h.db.select().from(scoreSheet)).toEqual([]);
    expect(await h.db.select().from(criterionScore)).toEqual([]);
    expect(await as.getBlindEntry(input)).toEqual({
      ok: false,
      error: "entry_not_found",
    });
    expect((await audit()).map((a) => a.action)).toEqual([
      "score_sheet.completed",
      "score_sheet.changed",
    ]);
  });

  it("requires assignment, current terms and current conflict-free role; locked rounds are read-only", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    const judge = h.as(w.judge);
    const input = { roundId: w.roundId, entryCode: w.code };
    const detail = await judge.getBlindEntry(input);
    if (!detail.ok) throw new Error(detail.error);
    const save = {
      ...input,
      baseVersion: 0,
      scores: { [detail.criteria[0]!.id]: 5 },
    };
    for (const actor of [w.otherJudge, w.manager, w.outsider, h.visitor()])
      expect(await h.as(actor).saveScoreSheet(save)).toEqual({
        ok: false,
        error: "entry_not_found",
      });
    expect(await h.as(w.newJudge).saveScoreSheet(save)).toEqual({
      ok: false,
      error: "not_onboarded",
    });
    expect(
      await judge.saveScoreSheet({ ...save, entryCode: w.otherCode })
    ).toEqual({ ok: false, error: "entry_not_found" });
    expect(await judge.saveScoreSheet(save)).toMatchObject({ ok: true });
    await h.db
      .update(judgingRound)
      .set({ status: "locked" })
      .where(eq(judgingRound.id, w.roundId));
    expect(await judge.getBlindEntry(input)).toMatchObject({
      ok: true,
      round: { status: "locked" },
      sheet: { version: 1 },
    });
    expect(
      await judge.saveScoreSheet({ ...save, baseVersion: 1, comment: "Locked" })
    ).toEqual({ ok: false, error: "round_locked" });
    expect(
      await judge.saveScoreSheet({ ...save, entryCode: w.otherCode })
    ).toEqual({ ok: false, error: "entry_not_found" });
    await h.db
      .update(judgingRound)
      .set({ status: "draft" })
      .where(eq(judgingRound.id, w.roundId));
    expect(await judge.getBlindEntry(input)).toEqual({
      ok: false,
      error: "entry_not_found",
    });
    expect(await judge.saveScoreSheet(save)).toEqual({
      ok: false,
      error: "entry_not_found",
    });
  });
});
