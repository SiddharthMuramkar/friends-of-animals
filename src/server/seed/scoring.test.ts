import { eq } from "drizzle-orm";
import { physicalArtwork } from "../db/schema";
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_JUDGING } from "./judging-rounds";
import { SEED_COMPETITION_MANAGER } from "./competitions";
import { SEED_SCORING } from "./scoring";

describe("blind scoring preview", () => {
  it("shows three types of work at different scoring stages and never resets saved work on reseed", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const app = h.as(await h.signIn(SEED_SCORING.judges[0]));
    const roundId = SEED_SCORING.roundId;
    const staff = h.as(await h.signIn(SEED_COMPETITION_MANAGER));
    expect(await staff.getRoundRankings({ roundId })).toMatchObject({
      ok: true,
      assignedCount: 6,
      unscoredCount: 4,
      ranked: [
        {
          code: "JURY27-E-5EED03",
          rank: 1,
          scoreNumerator: "70",
          scoreDenominator: "1",
          sheetsCounted: 2,
        },
      ],
      unscored: expect.arrayContaining(
        [{ code: "JURY27-E-5EED01" }, { code: "JURY27-E-5EED02" }].map((e) =>
          expect.objectContaining(e)
        )
      ),
    });
    const list = await app.listMyAssignments({ roundId });
    expect(list).toMatchObject({
      ok: true,
      entries: [
        { entryCode: "JURY27-E-5EED01", progress: "not_started" },
        { entryCode: "JURY27-E-5EED02", progress: "in_progress" },
        { entryCode: "JURY27-E-5EED03", progress: "complete" },
      ],
    });
    for (const [code, kind] of [
      ["JURY27-E-5EED01", "image"],
      ["JURY27-E-5EED02", "video"],
      ["JURY27-E-5EED03", "essay_text"],
    ] as const) {
      const result = await app.getBlindEntry({ roundId, entryCode: code });
      expect(result).toMatchObject({ ok: true, view: { media: [{ kind }] } });
      if (!result.ok) throw new Error(result.error);
      const media = result.view.media[0];
      if (media?.kind === "image" || media?.kind === "video")
        expect(await h.storage.get(media.url)).toMatchObject({ ok: true });
    }
    expect(
      await app.saveScoreSheet({
        roundId,
        entryCode: "JURY27-E-5EED01",
        baseVersion: 0,
        comment: "Reread tomorrow",
      })
    ).toMatchObject({ ok: true });
    await h.seed.preview();
    expect(
      await app.getBlindEntry({ roundId, entryCode: "JURY27-E-5EED01" })
    ).toMatchObject({
      ok: true,
      sheet: { version: 1, comment: { text: "Reread tomorrow" } },
    });
  });
  it("shows only the physically ready original artwork in the seeded physical final", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const judge = h.as(await h.signIn(SEED_JUDGING.onboardedJudge));
    const roundId = SEED_JUDGING.openRoundId;
    const list = await judge.listMyAssignments({ roundId });
    expect(list).toMatchObject({
      ok: true,
      entries: [
        { entryCode: "ORIG27-E-5EED06" },
        { entryCode: "ORIG27-E-5EED07" },
      ],
    });
    expect(
      await judge.getBlindEntry({ roundId, entryCode: "ORIG27-E-5EED04" })
    ).toEqual({ ok: false, error: "entry_not_found" });
    const input = { roundId, entryCode: "ORIG27-E-5EED06" };
    const detail = await judge.getBlindEntry(input);
    expect(detail).toMatchObject({
      ok: true,
      view: { media: [{ kind: "image" }] },
    });
    if (!detail.ok) throw new Error(detail.error);
    expect(
      await judge.saveScoreSheet({
        ...input,
        baseVersion: 0,
        scores: { [detail.criteria[0]!.id]: 7 },
      })
    ).toMatchObject({ ok: true, progress: "in_progress" });
    // A custody change after admission must hide the work on the next
    // read and refuse a save from an already-open scoring window.
    await h.db
      .update(physicalArtwork)
      .set({ status: "returned" })
      .where(eq(physicalArtwork.artworkCode, "ORIG27-A-5EED06"));
    expect(await judge.listMyAssignments({ roundId })).toMatchObject({
      ok: true,
      entries: [{ entryCode: "ORIG27-E-5EED07" }],
    });
    expect(await judge.getBlindEntry(input)).toEqual({
      ok: false,
      error: "entry_not_found",
    });
    expect(
      await judge.saveScoreSheet({
        ...input,
        baseVersion: 1,
        comment: "Work no longer held",
      })
    ).toEqual({ ok: false, error: "entry_not_found" });
  });
});
