import { describe, expect, it } from "vitest";

import {
  bootstrapTarget,
  parseBootstrapArgs,
} from "./bootstrap-super-admin-args";

describe("parseBootstrapArgs", () => {
  it("reads the email and the name", () => {
    expect(
      parseBootstrapArgs(["--email", "owner@example.test", "--name", "Owner"])
    ).toEqual({ ok: true, email: "owner@example.test", name: "Owner" });
  });

  it("names a new account FOA super admin when no name is given", () => {
    expect(parseBootstrapArgs(["--email=owner@example.test"])).toEqual({
      ok: true,
      email: "owner@example.test",
      name: "FOA super admin",
    });
  });

  it("reads the target the operator confirms", () => {
    expect(
      parseBootstrapArgs([
        "--email",
        "owner@example.test",
        "--target",
        "db.example.org/foa",
      ])
    ).toEqual({
      ok: true,
      email: "owner@example.test",
      name: "FOA super admin",
      target: "db.example.org/foa",
    });
  });

  it("needs a valid email", () => {
    for (const args of [[], ["--email", "not-an-email"], ["--name", "Owner"]]) {
      expect(parseBootstrapArgs(args)).toEqual({
        ok: false,
        error: expect.stringContaining("--email"),
      });
    }
  });

  it("refuses an option it doesn't know", () => {
    expect(
      parseBootstrapArgs(["--email", "owner@example.test", "--role", "judge"])
    ).toEqual({ ok: false, error: expect.stringContaining("--role") });
  });
});

describe("bootstrapTarget", () => {
  const remote =
    "postgres://foa_migrator:s3cret@db.example.org:6432/foa?sslmode=verify-full";

  it("names a local database's host and database, with no confirmation needed", () => {
    expect(
      bootstrapTarget("postgres://foa:foa@localhost:5432/foa", undefined)
    ).toEqual({ ok: true, host: "localhost", database: "foa" });
  });

  it("refuses a database on another machine without --target", () => {
    const result = bootstrapTarget(remote, undefined);

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("--target db.example.org/foa"),
    });
    expect(JSON.stringify(result)).not.toMatch(/s3cret|foa_migrator/);
  });

  it("refuses a --target that doesn't name DIRECT_URL's host and database", () => {
    for (const target of [
      "db.example.org/foa_staging",
      "other.org/foa",
      "foa",
    ]) {
      const result = bootstrapTarget(remote, target);
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("doesn't match"),
      });
      expect(JSON.stringify(result)).not.toMatch(/s3cret|foa_migrator/);
    }
  });

  it("takes a database on another machine when --target names it", () => {
    expect(bootstrapTarget(remote, "DB.example.org/foa")).toEqual({
      ok: true,
      host: "db.example.org",
      database: "foa",
    });
  });

  it("refuses a URL the database client could read as another host, even with --target", () => {
    const tricky = "postgres://foa:foa@localhost/foa?host=db.example.org";
    expect(bootstrapTarget(tricky, "localhost/foa")).toEqual({
      ok: false,
      error: expect.stringContaining("?host="),
    });
  });

  it("refuses a URL with no host, whatever --target says", () => {
    // postgres-js connects such a URL to PGHOST, else localhost, so
    // "Target: /foa" wouldn't say which database the bootstrap writes to.
    // Each passes the env schema.
    for (const url of [
      "postgres:///foa",
      "postgresql:///foa?sslmode=require",
      "postgres:/foa",
    ]) {
      for (const confirmed of [undefined, "/foa", "localhost/foa"]) {
        expect(bootstrapTarget(url, confirmed), `${url} ${confirmed}`).toEqual({
          ok: false,
          error: expect.stringContaining("names no host"),
        });
      }
    }
  });
});
