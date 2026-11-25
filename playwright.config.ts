import { defineConfig, devices } from "@playwright/test";

import { BYPASS_STATE_PATH, bypassSecretFor } from "./tests/e2e/vercel-bypass";

// Seam 2 (spec #55): journeys run against a server that is already running,
// never one started here: `next start` in CI (.github/workflows/ci.yml), or a
// deployment. PLAYWRIGHT_BASE_URL names it; a protected Vercel deployment
// also needs VERCEL_AUTOMATION_BYPASS_SECRET to get past Vercel
// Authentication (see tests/e2e/global-setup.ts).
const target = process.env.PLAYWRIGHT_BASE_URL;
if (!target) {
  throw new Error(
    "Set PLAYWRIGHT_BASE_URL to the server to test, e.g. http://localhost:3000."
  );
}
// A bare host, as Vercel's dashboard shows it, means https.
const baseURL = /^https?:\/\//.test(target) ? target : `https://${target}`;
const usesBypass = bypassSecretFor(baseURL) !== undefined;

/** The production smoke suite, which only its own project runs. */
const PROD_SMOKE = "prod-smoke.spec.ts";
// Locking the ledger is a database-global change. CI gives each of these
// projects its own service, isolated from other payment/ledger journeys.
const TRANSPARENCY = "110-transparency.spec.ts";

export default defineConfig({
  testDir: "./tests/e2e",
  // *.test.ts files beside them are Vitest unit tests.
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a violation that shows up only some of the time is still a
  // violation, and a retry would let it pass as "flaky".
  retries: 0,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL,
    // The bypass cookie from global setup, not the secret itself: traces
    // record request headers and are uploaded as CI artefacts.
    storageState: usesBypass ? BYPASS_STATE_PATH : undefined,
    // Entrance animations would otherwise be caught mid-fade by axe's
    // colour-contrast rule.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: [PROD_SMOKE, TRANSPARENCY],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: [PROD_SMOKE, TRANSPARENCY],
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "transparency-desktop",
      testMatch: TRANSPARENCY,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "transparency-mobile",
      testMatch: TRANSPARENCY,
      use: { ...devices["Pixel 7"] },
    },
    // Read-only checks of a live production deployment (.github/workflows/
    // e2e.yml); never part of the journeys above.
    {
      name: "prod-smoke",
      testMatch: PROD_SMOKE,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
