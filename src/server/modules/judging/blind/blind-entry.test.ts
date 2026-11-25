import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { fileDerivative, entryFile } from "../../../db/schema";
import { scoringWorld, identifiableWork } from "../blind-testing";
import { keyPaths } from "./domain/blind-entry-view";

describe("getBlindEntry", () => {
  it("delivers an assigned entry through an explicit identity-free projection and expiring derivatives", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    const privateValues = await identifiableWork(h, w);
    const judge = h.as(w.judge);
    const input = { roundId: w.roundId, entryCode: w.code };
    const result = await judge.getBlindEntry(input);
    expect(result).toMatchObject({
      ok: true,
      view: {
        entryCode: w.code,
        discipline: "photography",
        media: [{ kind: "image" }],
      },
      progress: "not_started",
    });
    if (!result.ok) throw new Error(result.error);
    expect(keyPaths(result.view)).toEqual([
      "ageGroupLabel",
      "categoryLabel",
      "discipline",
      "entryCode",
      "media",
      "media[].height",
      "media[].kind",
      "media[].thumbnailUrl",
      "media[].url",
      "media[].width",
    ]);
    const serialized = JSON.stringify(result);
    for (const personal of privateValues.filter(Boolean))
      expect(serialized).not.toContain(personal);
    const [media] = result.view.media;
    if (media?.kind !== "image") throw new Error("Missing image");
    expect(media.url).toContain("/derived/");
    expect(media.url).toContain("display_1600.webp");
    expect(media.thumbnailUrl).toContain("thumb_320.webp");
    expect(await h.storage.get(media.url)).toMatchObject({
      ok: true,
      contentType: "image/webp",
      contentDisposition: 'inline; filename="work-1.webp"',
      cacheControl: "private, no-store",
    });
    h.clock.advance({ seconds: 301 });
    expect(await h.storage.get(media.url)).toEqual({
      ok: false,
      error: "expired",
    });
    const [file] = await h.db
      .select({ fileId: entryFile.fileAssetId })
      .from(entryFile)
      .where(eq(entryFile.entryId, w.entryId));
    await h.db
      .delete(fileDerivative)
      .where(
        and(
          eq(fileDerivative.fileAssetId, file!.fileId!),
          eq(fileDerivative.kind, "display_1600")
        )
      );
    expect(await judge.getBlindEntry(input)).toMatchObject({
      ok: true,
      view: { media: [{ kind: "unavailable" }] },
    });
  });
  it("refuses unassigned, missing, other-round and newly conflicted entries without disclosing existence", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    const refusal = { ok: false, error: "entry_not_found" };
    const input = { roundId: w.roundId, entryCode: w.code };
    const judge = h.as(w.judge);
    expect(
      await judge.getBlindEntry({ ...input, entryCode: w.otherCode })
    ).toEqual(refusal);
    expect(
      await judge.getBlindEntry({ ...input, entryCode: "FOA27-E-XXXXXX" })
    ).toEqual(refusal);
    for (const actor of [w.manager, w.otherJudge, w.outsider, h.visitor()])
      expect(await h.as(actor).getBlindEntry(input)).toEqual(refusal);
    expect(await h.as(w.newJudge).getBlindEntry(input)).toEqual({
      ok: false,
      error: "not_onboarded",
    });
    // The relation came after assignment: both reads have to recheck it.
    await h.seed.grant(w.judgeUser, {
      role: "institution_coordinator",
      scope: { type: "institution", id: w.school.institutionId },
    });
    expect(await judge.getBlindEntry(input)).toEqual(refusal);
    expect(await judge.listMyAssignments({ roundId: w.roundId })).toMatchObject(
      { ok: true, entries: [] }
    );
  });
});
