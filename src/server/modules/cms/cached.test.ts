import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canReadWhilePrerendering } from "./cached";

// The home page's static shell renders the published documents when it can
// (Live's `published`). `next build` has no runtime config and must pass
// without a database (spec §1.7 trap 15), so the shell must never read
// while the build prerenders it, even when the build happens to have
// database settings (CI's E2E build, or a checkout's .env). The server
// reads them when it regenerates the page.

/** Settings with which the app's runtime config parses, as in CI's build. */
function stubDatabaseSettings() {
  vi.stubEnv("APP_ENV", "local");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgres://foa:foa@127.0.0.1:5432/foa");
  vi.stubEnv("DIRECT_URL", "postgres://foa:foa@127.0.0.1:5432/foa");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the static shell's read of published documents", () => {
  it("never runs while `next build` prerenders, even with database settings", () => {
    stubDatabaseSettings();
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
    expect(canReadWhilePrerendering()).toBe(false);
  });

  it("never runs while `next build` prerenders without database settings", () => {
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIRECT_URL", "");
    expect(canReadWhilePrerendering()).toBe(false);
  });

  it("runs when the server regenerates the page", () => {
    stubDatabaseSettings();
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_SERVER);
    expect(canReadWhilePrerendering()).toBe(true);
  });

  it("runs under next dev", () => {
    stubDatabaseSettings();
    vi.stubEnv("NEXT_PHASE", PHASE_DEVELOPMENT_SERVER);
    expect(canReadWhilePrerendering()).toBe(true);
  });
});
