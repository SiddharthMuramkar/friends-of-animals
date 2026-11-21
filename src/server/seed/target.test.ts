import { describe, expect, it } from "vitest";

import { MIGRATIONS_FINGERPRINT } from "../db/database-url";
import { seedTarget } from "./target";

const DIRECT_URL = "postgres://foa:foa@localhost:5432/foa";

describe("seedTarget", () => {
  it("seeds the local database", () => {
    expect(seedTarget({ DIRECT_URL, APP_ENV: "local" })).toEqual({
      seed: true,
      url: DIRECT_URL,
    });
    expect(seedTarget({ DIRECT_URL })).toEqual({ seed: true, url: DIRECT_URL });
  });

  it("seeds a preview's own database, as the migration does", () => {
    expect(
      seedTarget({
        DIRECT_URL: "postgres://m:p@db.example.test:6432/foa_pr",
        APP_ENV: "preview",
        VERCEL_GIT_PULL_REQUEST_ID: "140",
        VERCEL_GIT_COMMIT_REF: "ticket/57-harness",
      })
    ).toEqual({
      seed: true,
      url: `postgres://m:p@db.example.test:6432/foa_pr_140_${MIGRATIONS_FINGERPRINT}`,
    });
  });

  it("seeds a local database on this machine or in Compose", () => {
    for (const url of [
      "postgres://foa:foa@127.0.0.1:5432/foa",
      "postgres://foa:foa@[::1]:5432/foa",
      "postgres://foa:foa@db:5432/foa",
    ]) {
      expect(seedTarget({ DIRECT_URL: url })).toEqual({ seed: true, url });
    }
  });

  it("refuses a local run aimed at another host", () => {
    // APP_ENV unset counts as local. A hand-run seed with a deployed
    // DIRECT_URL must not plant the seed accounts there.
    for (const APP_ENV of [undefined, "local"] as const) {
      const target = seedTarget({
        DIRECT_URL:
          "postgres://foa_migrator:x@db.shipped-it.dev:6432/foa?sslmode=verify-full",
        APP_ENV,
      });
      expect(target).toEqual({
        seed: false,
        reason: expect.stringMatching(/db\.shipped-it\.dev/),
      });
    }
  });

  it("refuses a local URL whose query names another host", () => {
    // postgres-js connects to ?host= over the URL's own host.
    for (const param of ["host", "hostaddr"]) {
      const target = seedTarget({
        DIRECT_URL: `postgres://foa:foa@localhost:5432/foa?${param}=db.shipped-it.dev`,
      });
      expect(target).toEqual({
        seed: false,
        reason: expect.stringMatching(new RegExp(param)),
      });
    }
  });

  it("refuses a local URL that tunnels into a deployed database", () => {
    // An SSH tunnel (docker/README.md) or PgBouncer on the database server
    // reaches pg-prod or pg-nonprod through a loopback address, so a local
    // seed also refuses their roles and databases.
    for (const url of [
      "postgres://postgres:x@localhost:5433/foa",
      "postgres://foa_migrator:x@127.0.0.1:5433/foa",
      "postgres://foa_app:x@localhost:6432/foa",
      "postgres://staging_migrator:x@localhost:5434/foa_staging",
      "postgres://nonprod_migrator:x@localhost:5434/foa_pr_140_abc",
      "postgres://foa:foa@localhost:5434/foa_staging",
      "postgres://foa:foa@localhost:5434/foa_seed",
    ]) {
      expect(seedTarget({ DIRECT_URL: url }), url).toEqual({
        seed: false,
        reason: expect.stringMatching(/deployed/),
      });
    }
  });

  it.each(["staging", "production"] as const)("never seeds %s", (APP_ENV) => {
    const target = seedTarget({ DIRECT_URL, APP_ENV });
    expect(target.seed).toBe(false);
  });
});
