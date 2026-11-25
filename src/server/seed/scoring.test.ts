import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_SCORING } from "./scoring";

describe("blind scoring preview", () => {
  it("shows three types of work at different scoring stages and never resets saved work on reseed", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const app = h.as(await h.signIn(SEED_SCORING.judges[0]));
    const roundId = SEED_SCORING.roundId;
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
});
