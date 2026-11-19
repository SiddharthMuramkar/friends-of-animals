import { defineConfig, devices } from "@playwright/test";

import { BYPASS_STATE_PATH, bypassSecretFor } from "./tests/e2e/vercel-bypass";

// Seam 2 (spec #55): journeys run against a deployed preview, never a dev
// server started here. PLAYWRIGHT_BASE_URL names the deployment; a Vercel
// preview also needs VERCEL_AUTOMATION_BYPASS_SECRET to get past Vercel
// Authentication (see tests/e2e/global-setup.ts).
const target = process.env.PLAYWRIGHT_BASE_URL;
if (!target) {
  throw new Error(
    "Set PLAYWRIGHT_BASE_URL to the deployment to test, e.g. a PR preview URL."
  );
}
// A bare host, as Vercel's dashboard shows it, means https.
const baseURL = /^https?:\/\//.test(target) ? target : `https://${target}`;
const usesBypass = bypassSecretFor(baseURL) !== undefined;

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
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
