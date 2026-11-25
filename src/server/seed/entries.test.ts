import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { entryFile, fileDerivative } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_ACCOUNTS } from "./accounts";
import { seedEntries } from "./entries";

describe("the entries seed", () => {
  it("shows a participant one submitted, one processing and one rejected entry", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const asha = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
    const entries = await asha.listMyEntries();

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ORIG27-E-5EED04",
          status: "foa_verified",
          checking: false,
        }),
        expect.objectContaining({
          code: "NEIGH27-E-5EEDA1",
          status: "submitted",
          checking: false,
        }),
        expect.objectContaining({
          code: "ROOF27-E-5EEDA2",
          status: "processing",
          checking: true,
        }),
        expect.objectContaining({
          code: "BIRDS27-E-5EEDA3",
          status: "rejected",
          checking: false,
        }),
      ])
    );
    expect(entries).toHaveLength(4);
    expect(
      new Set(entries.map(({ registrationId }) => registrationId)).size
    ).toBe(4);
    // The rejected one can be tried again with another image.
    await expect(
      asha.getEntry({ code: "BIRDS27-E-5EEDA3" })
    ).resolves.toMatchObject({
      ok: true,
      entry: {
        latestUpload: "rejected",
        uploadRule: { maxBytes: 20 * 1024 * 1024 },
      },
    });

    await h.seed.preview();
    expect(await asha.listMyEntries()).toEqual(entries);
  });

  it("serves the submitted entry's picture from storage, also after reseeding", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.seed.preview();
    const asha = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));

    const result = await asha.getEntry({ code: "NEIGH27-E-5EEDA1" });

    if (!result.ok) throw new Error("Missing seeded entry");
    expect(result.entry.status).toBe("submitted");
    expect(result.entry.picture).not.toBeNull();
    const copy = await h.storage.get(result.entry.picture!.url);
    expect(copy).toMatchObject({ ok: true, contentType: "image/webp" });
    if (copy.ok) expect(copy.bytes.length).toBeGreaterThan(0);
  });

  it("leaves the picture out without storage, and a later seed with storage adds it", async () => {
    const h = await createHarness();
    const { storage: _storage, ...withoutStorage } = h.deps;
    await h.seed.preview();
    const [live] = await h.db
      .select({ assetId: entryFile.fileAssetId })
      .from(entryFile)
      .where(and(eq(entryFile.status, "live"), eq(entryFile.kind, "image")));
    const assetId = live!.assetId!;
    await h.db
      .delete(fileDerivative)
      .where(eq(fileDerivative.fileAssetId, assetId));

    await seedEntries(withoutStorage);
    expect(
      await h.db
        .select()
        .from(fileDerivative)
        .where(eq(fileDerivative.fileAssetId, assetId))
    ).toEqual([]);

    await seedEntries(h.deps);
    expect(
      (
        await h.db
          .select({ kind: fileDerivative.kind })
          .from(fileDerivative)
          .where(eq(fileDerivative.fileAssetId, assetId))
      )
        .map(({ kind }) => kind)
        .toSorted()
    ).toEqual(["display_1600", "thumb_320"]);
  });

  it("shows Ravi a submitted video, playing from its copy and poster, and a typed essay (#86)", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.seed.preview();
    const ravi = h.as(
      await h.signIn(SEED_ACCOUNTS.members[1], undefined, {
        secondFactor: false,
      })
    );

    const entries = await ravi.listMyEntries();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ROOF27-E-5EEDB1",
          status: "submitted",
        }),
        expect.objectContaining({
          code: "BIRDS27-E-5EEDB2",
          status: "submitted",
        }),
        expect.objectContaining({
          code: "ORIG27-E-5EED05",
          status: "foa_verified",
        }),
      ])
    );
    expect(entries).toHaveLength(3);
    const video = await ravi.getEntry({ code: "ROOF27-E-5EEDB1" });
    if (!video.ok) throw new Error("Missing seeded video");
    expect(video.entry).toMatchObject({
      format: "video",
      discipline: "videography",
      video: { width: 640, height: 360, durationMs: 4_000 },
      uploadRule: { kind: "video" },
    });
    expect(await h.storage.get(video.entry.video!.url)).toMatchObject({
      ok: true,
      contentType: "video/mp4",
    });
    expect(await h.storage.get(video.entry.video!.posterUrl!)).toMatchObject({
      ok: true,
      contentType: "image/jpeg",
    });

    const essay = await ravi.getEntry({ code: "BIRDS27-E-5EEDB2" });
    if (!essay.ok) throw new Error("Missing seeded essay");
    expect(essay.entry).toMatchObject({
      format: "essay",
      essay: { kind: "text", wordCount: 75 },
    });
    if (essay.entry.essay?.kind !== "text") throw new Error("no text");
    expect(essay.entry.essay.body.paragraphs).toHaveLength(3);
  });
});
