import { describe, expect, it } from "vitest";

import { parseOffsiteRestoreArgs } from "./offsite-restore-args";

describe("parseOffsiteRestoreArgs", () => {
  it("reads the bucket, the key, another bucket to restore into and --overwrite", () => {
    expect(
      parseOffsiteRestoreArgs([
        "--bucket",
        "foa-files-prod",
        "--key",
        "submission/0190a1b2-0000-7000-8000-000000000001",
        "--to",
        "foa-restore-check",
        "--overwrite",
      ])
    ).toEqual({
      ok: true,
      bucket: "foa-files-prod",
      key: "submission/0190a1b2-0000-7000-8000-000000000001",
      to: "foa-restore-check",
      overwrite: true,
    });
  });

  it("restores into the same bucket and keeps an existing object by default", () => {
    expect(
      parseOffsiteRestoreArgs([
        "--",
        "--bucket=foa-files-prod",
        "--key=avatar/a",
      ])
    ).toEqual({
      ok: true,
      bucket: "foa-files-prod",
      key: "avatar/a",
      to: "foa-files-prod",
      overwrite: false,
    });
  });

  it.each([
    [["--key", "avatar/a"], "--bucket"],
    [["--bucket", "foa-files-prod"], "--key"],
    [["--bucket", "foa-files-prod", "--key", ""], "--key"],
    [["--bucket", "Not_A_Bucket", "--key", "avatar/a"], "--bucket"],
    [["--bucket", "foa-files-prod", "--key", "avatar/a", "--to", "X"], "--to"],
  ])("refuses %j, naming %s", (args, option) => {
    expect(parseOffsiteRestoreArgs(args)).toEqual({
      ok: false,
      error: expect.stringContaining(option),
    });
  });

  it("refuses an option it doesn't know", () => {
    expect(
      parseOffsiteRestoreArgs([
        "--bucket",
        "foa-files-prod",
        "--key",
        "avatar/a",
        "--force",
      ])
    ).toEqual({ ok: false, error: expect.stringContaining("--force") });
  });
});
