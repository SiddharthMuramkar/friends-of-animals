import { eq } from "drizzle-orm";
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
    expect(entries).toHaveLength(3);
    expect(
      new Set(entries.map(({ registrationId }) => registrationId)).size
    ).toBe(3);
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
      .where(eq(entryFile.status, "live"));
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
});
