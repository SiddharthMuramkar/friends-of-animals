import { describe, expect, it } from "vitest";

import { FakeClock } from "@/test/fakes/clock";
import { FakeStorage } from "@/test/fakes/storage";

import { purgePreviewFiles } from "./purge";

const BUCKET = "foa-files-nonprod";
const FP = "0123abcd";

/**
 * Objects of two PR previews, a branch preview, staging and a local run,
 * sorted as `FakeStorage.keys()` lists them.
 */
const KEYS = [
  "pr-12/test_upload/01938a00-0000-7000-8000-000000000001",
  "pr-12/quarantine/01938a00-0000-7000-8000-000000000002",
  "pr-120/test_upload/01938a00-0000-7000-8000-000000000003",
  "staging/test_upload/01938a00-0000-7000-8000-000000000004",
  "br-abcd1234/test_upload/01938a00-0000-7000-8000-000000000005",
  "local/test_upload/01938a00-0000-7000-8000-000000000006",
].sort();

function world(appEnv: "local" | "preview" | "staging" | "production") {
  const storage = new FakeStorage(new FakeClock());
  for (const key of KEYS) {
    storage.plant({
      bucket: BUCKET,
      key,
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    });
  }
  return { storage, deps: { storage, bucket: BUCKET, appEnv } };
}

describe("purgePreviewFiles", () => {
  it("deletes only the dropped PR preview's prefix, not pr-120/", async () => {
    const { storage, deps } = world("preview");

    const result = await purgePreviewFiles(deps, {
      database: `foa_pr_12_${FP}`,
    });

    expect(result).toEqual({ prefix: "pr-12/", deleted: 2 });
    expect(storage.keys(BUCKET)).toEqual(
      KEYS.filter((key) => !key.startsWith("pr-12/"))
    );
  });

  it("deletes a branch preview's prefix", async () => {
    const { storage, deps } = world("preview");

    const result = await purgePreviewFiles(deps, {
      database: `foa_br_feature_x_abcd1234_${FP}`,
    });

    expect(result).toEqual({ prefix: "br-abcd1234/", deleted: 1 });
    expect(storage.keys(BUCKET)).toEqual(
      KEYS.filter((key) => !key.startsWith("br-abcd1234/"))
    );
  });

  it("says so when the preview stored nothing", async () => {
    const { storage, deps } = world("preview");

    const result = await purgePreviewFiles(deps, {
      database: `foa_pr_7_${FP}`,
    });

    expect(result).toEqual({ prefix: "pr-7/", deleted: 0 });
    expect(storage.keys(BUCKET)).toEqual(KEYS);
  });

  it.each([
    ["the production database", "foa"],
    ["the seed template", "foa_seed"],
    ["staging's database", "foa_staging"],
    ["the server's own database", "postgres"],
    ["a template", "template1"],
    ["an empty name", ""],
    ["a name of spaces", "   "],
    ["a PR database without its fingerprint", "foa_pr_12"],
    ["a PR number with a leading zero", `foa_pr_012_${FP}`],
    ["an upper-case name", `FOA_PR_12_${FP}`],
    ["a name with a path in it", `foa_pr_12_${FP}/../staging`],
    ["a name with SQL in it", `foa_pr_12_${FP}"; DROP DATABASE foa; --`],
  ])("refuses %s and deletes nothing", async (_, database) => {
    const { storage, deps } = world("preview");

    await expect(purgePreviewFiles(deps, { database })).rejects.toThrow(
      /not a preview database/i
    );
    expect(storage.keys(BUCKET)).toEqual(KEYS);
  });

  it("refuses outright when APP_ENV is production", async () => {
    const { storage, deps } = world("production");

    await expect(
      purgePreviewFiles(deps, { database: `foa_pr_12_${FP}` })
    ).rejects.toThrow(/production/);
    expect(storage.keys(BUCKET)).toEqual(KEYS);
  });

  it.each(["local", "staging"] as const)(
    "purges a preview's prefix from APP_ENV=%s too",
    async (appEnv) => {
      const { deps } = world(appEnv);

      await expect(
        purgePreviewFiles(deps, { database: `foa_pr_12_${FP}` })
      ).resolves.toEqual({ prefix: "pr-12/", deleted: 2 });
    }
  );
});
