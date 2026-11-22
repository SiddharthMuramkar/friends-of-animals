import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isNextBuild } from "./cached";

// The home page's static shell renders the published documents when it can
// (Live's `published`), but never in `next build`: the build has no runtime
// config and must pass with DATABASE_URL unset, so the shell must not read
// even when the build happens to have database settings (CI's E2E build,
// or a checkout's .env). The server reads them when it regenerates the
// page.

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

describe("telling `next build` from the running server", () => {
  it("knows `next build`, even with database settings", () => {
    stubDatabaseSettings();
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
    expect(isNextBuild()).toBe(true);
  });

  it("knows `next build` without database settings", () => {
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIRECT_URL", "");
    expect(isNextBuild()).toBe(true);
  });

  it("lets the server read when it regenerates the page", () => {
    stubDatabaseSettings();
    // `next start` leaves NEXT_PHASE unset; only `next build` sets it.
    vi.stubEnv("NEXT_PHASE", undefined);
    expect(isNextBuild()).toBe(false);
  });

  it("lets next dev read", () => {
    stubDatabaseSettings();
    vi.stubEnv("NEXT_PHASE", PHASE_DEVELOPMENT_SERVER);
    expect(isNextBuild()).toBe(false);
  });
});
