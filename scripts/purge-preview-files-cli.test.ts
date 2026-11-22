import { describe, expect, it } from "vitest";

import type { ObjectStorage } from "../src/server/ports/storage";
import { FakeClock } from "../src/test/fakes/clock";
import { FakeStorage } from "../src/test/fakes/storage";
import {
  parsePurgeArgs,
  runPurgePreviewFiles,
  type R2Credentials,
} from "./purge-preview-files-cli";

const DATABASE = "foa_pr_12_0123abcd";

/** A non-production deployment's R2 variables (none of them real). */
const R2_ENV = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key-do-not-print",
  R2_BUCKET: "foa-files-nonprod",
};

describe("parsePurgeArgs", () => {
  it("reads the dropped database's name", () => {
    expect(parsePurgeArgs(["--database", DATABASE])).toEqual({
      ok: true,
      database: DATABASE,
    });
    expect(parsePurgeArgs([`--database=${DATABASE}`])).toEqual({
      ok: true,
      database: DATABASE,
    });
  });

  it("skips the separator pnpm passes on", () => {
    expect(parsePurgeArgs(["--", "--database", DATABASE])).toEqual({
      ok: true,
      database: DATABASE,
    });
  });

  it.each([
    ["no arguments", []],
    ["--database without a value", ["--database"]],
    ["an empty name", ["--database", ""]],
    ["a positional name", [DATABASE]],
    ["an unknown option", ["--database", DATABASE, "--all"]],
  ])("refuses %s, with the usage", (_, argv) => {
    const parsed = parsePurgeArgs(argv);
    expect(parsed).toEqual({
      ok: false,
      error: expect.stringContaining(
        "Usage: pnpm files:purge-preview --database <name>"
      ),
    });
  });
});

/** Runs the command over a FakeStorage holding pr-12/ and pr-120/ objects. */
async function run(argv: string[], env: Record<string, string | undefined>) {
  const storage = new FakeStorage(new FakeClock());
  for (const key of ["pr-12/test_upload/a", "pr-120/test_upload/b"]) {
    storage.plant({
      bucket: R2_ENV.R2_BUCKET,
      key,
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    });
  }
  const out: string[] = [];
  const err: string[] = [];
  const opened: R2Credentials[] = [];
  const code = await runPurgePreviewFiles({
    argv,
    env,
    openStorage: (credentials): ObjectStorage => {
      opened.push(credentials);
      return storage;
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return {
    code,
    out: out.join("\n"),
    err: err.join("\n"),
    keys: storage.keys(R2_ENV.R2_BUCKET),
    opened,
  };
}

describe("runPurgePreviewFiles", () => {
  it("purges the preview's prefix and exits 0", async () => {
    const result = await run(["--database", DATABASE], {
      APP_ENV: "preview",
      ...R2_ENV,
    });

    expect(result.code).toBe(0);
    expect(result.keys).toEqual(["pr-120/test_upload/b"]);
    expect(result.out).toContain("pr-12/");
    expect(result.out).toContain("1");
    expect(result.opened).toEqual([
      {
        accountId: R2_ENV.R2_ACCOUNT_ID,
        accessKeyId: R2_ENV.R2_ACCESS_KEY_ID,
        secretAccessKey: R2_ENV.R2_SECRET_ACCESS_KEY,
      },
    ]);
  });

  it("exits 2 with the usage for bad arguments, before reading R2", async () => {
    const result = await run([], { APP_ENV: "preview", ...R2_ENV });

    expect(result.code).toBe(2);
    expect(result.err).toContain("Usage: ");
    expect(result.opened).toEqual([]);
  });

  it.each(["foa", "foa_seed", "postgres", "foa_pr_12"])(
    "exits 2 for %s and deletes nothing",
    async (database) => {
      const result = await run(["--database", database], {
        APP_ENV: "preview",
        ...R2_ENV,
      });

      expect(result.code).toBe(2);
      expect(result.err).toMatch(/not a preview database/);
      expect(result.keys).toEqual([
        "pr-12/test_upload/a",
        "pr-120/test_upload/b",
      ]);
    }
  );

  it("exits 2 under APP_ENV=production and deletes nothing", async () => {
    const result = await run(["--database", DATABASE], {
      APP_ENV: "production",
      ...R2_ENV,
    });

    expect(result.code).toBe(2);
    expect(result.err).toMatch(/production/);
    expect(result.keys).toHaveLength(2);
  });

  it("exits 1 without the R2 variables, naming the missing one", async () => {
    const { R2_BUCKET: _, ...withoutBucket } = R2_ENV;
    const result = await run(["--database", DATABASE], {
      APP_ENV: "preview",
      ...withoutBucket,
    });

    expect(result.code).toBe(1);
    expect(result.err).toContain("R2_BUCKET");
    expect(result.opened).toEqual([]);
  });

  it("exits 1 when storage fails, without printing the secret", async () => {
    const storage = new FakeStorage(new FakeClock());
    storage.deletePrefix = () =>
      Promise.reject(new Error(`denied for ${R2_ENV.R2_SECRET_ACCESS_KEY}`));
    const err: string[] = [];

    const code = await runPurgePreviewFiles({
      argv: ["--database", DATABASE],
      env: { APP_ENV: "preview", ...R2_ENV },
      openStorage: () => storage,
      log: () => {},
      error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/failed/i);
    expect(err.join("\n")).not.toContain(R2_ENV.R2_SECRET_ACCESS_KEY);
  });
});
