import { describe, expect, it } from "vitest";

import { importTarget, parseImportPincodesArgs } from "./import-pincodes-args";

describe("parseImportPincodesArgs", () => {
  it("reads the file, and the target the operator confirms", () => {
    expect(parseImportPincodesArgs(["pincodes.csv"])).toEqual({
      ok: true,
      file: "pincodes.csv",
    });
    expect(
      parseImportPincodesArgs([
        "--",
        "pincodes.csv",
        "--target",
        "db.example.org/foa",
      ])
    ).toEqual({ ok: true, file: "pincodes.csv", target: "db.example.org/foa" });
  });

  it("needs exactly one file and no unknown options", () => {
    for (const args of [[], ["a.csv", "b.csv"], ["a.csv", "--dry"]]) {
      expect(parseImportPincodesArgs(args)).toMatchObject({
        ok: false,
        error: expect.stringContaining("Usage: pnpm directory:import-pincodes"),
      });
    }
  });
});

describe("importTarget", () => {
  it("imports into a local database as it is", () => {
    expect(
      importTarget("postgres://foa:foa@localhost:5432/foa", undefined)
    ).toEqual({ ok: true, host: "localhost", database: "foa" });
  });

  it("refuses another host unless --target names it", () => {
    const url = "postgres://foa_migrator:secret@db.example.org:6432/foa";
    const refused = importTarget(url, undefined);
    expect(refused).toMatchObject({
      ok: false,
      error: expect.stringContaining("pass --target db.example.org/foa"),
    });
    expect(JSON.stringify(refused)).not.toContain("secret");
    expect(importTarget(url, "db.example.org/foa")).toEqual({
      ok: true,
      host: "db.example.org",
      database: "foa",
    });
    expect(importTarget(url, "db.example.org/foa_staging")).toMatchObject({
      ok: false,
      error: expect.stringContaining("doesn't match DIRECT_URL"),
    });
  });
});
