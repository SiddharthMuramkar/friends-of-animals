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

  it.each(["staging", "production"] as const)("never seeds %s", (APP_ENV) => {
    const target = seedTarget({ DIRECT_URL, APP_ENV });
    expect(target.seed).toBe(false);
  });
});
