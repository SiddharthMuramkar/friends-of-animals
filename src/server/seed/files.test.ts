import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { fileAsset } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { seedFilesAt, seedFilesLocation } from "./files";
import { SEED_ACCOUNTS } from "./index";

describe("the files seed", () => {
  it("gives each seeded member one clean demo file, once", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.seed.preview();

    // The demo files; the payments seed adds a cheque's proof (#79).
    const rows = await h.db
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.purpose, "test_upload"))
      .orderBy(asc(fileAsset.ownerUserId));
    expect(rows.map((row) => row.ownerUserId)).toEqual(
      SEED_ACCOUNTS.members.map((member) => member.id)
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        purpose: "test_upload",
        contentType: "image/png",
        status: "clean",
        storageKey: `local/test_upload/${row.id}`,
      });
    }

    const [asha] = SEED_ACCOUNTS.members;
    const actor = await h.signIn(asha);
    expect(
      await h.as(actor).getFileStatus({ fileId: rows[0]!.id })
    ).toMatchObject({ ok: true, status: "clean" });
  });

  it("keys the rows under the preview's prefix and writes no object", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const demo = eq(fileAsset.purpose, "test_upload");
    await h.db.delete(fileAsset).where(demo);

    await seedFilesAt({ bucket: "foa-files-nonprod", keyPrefix: "pr-12/" })(
      h.deps
    );

    const rows = await h.db.select().from(fileAsset).where(demo);
    expect(rows).toHaveLength(SEED_ACCOUNTS.members.length);
    for (const row of rows) {
      expect(row.bucket).toBe("foa-files-nonprod");
      expect(row.storageKey).toBe(`pr-12/test_upload/${row.id}`);
    }
    expect(h.storage.keys("foa-files-nonprod")).toEqual([]);
  });
});

describe("seedFilesLocation", () => {
  it("is a PR preview's bucket and prefix", () => {
    expect(
      seedFilesLocation({
        APP_ENV: "preview",
        VERCEL_GIT_PULL_REQUEST_ID: "12",
        VERCEL_GIT_COMMIT_REF: "ticket/63-prefixes-seam2",
        R2_BUCKET: "foa-files-nonprod",
      })
    ).toEqual({ bucket: "foa-files-nonprod", keyPrefix: "pr-12/" });
  });

  it("is local/ in the disk store's bucket for a local run without R2", () => {
    // An unset APP_ENV is a local run, as everywhere else.
    for (const env of [{}, { APP_ENV: "local" }]) {
      expect(seedFilesLocation(env)).toEqual({
        bucket: "local",
        keyPrefix: "local/",
      });
    }
  });

  it("names no bucket for a deployment without R2, whose storage refuses every call", () => {
    expect(seedFilesLocation({ APP_ENV: "staging" })).toEqual({
      bucket: "unconfigured",
      keyPrefix: "staging/",
    });
  });
});
