import { request, type FullConfig } from "@playwright/test";

import { BYPASS_STATE_PATH, bypassSecretFor } from "./vercel-bypass";

/**
 * Trades the bypass secret for Vercel's bypass cookie once, before any test
 * runs, and saves it for every test's browser context (`storageState` in
 * playwright.config.ts). Tests then never send the secret, so it can't end
 * up in a trace, and it goes to no host but the preview.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const secret = bypassSecretFor(baseURL);
  if (!secret) return;

  const withSecret = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": secret,
      "x-vercel-set-bypass-cookie": "true",
    },
  });
  // Vercel answers with a redirect that sets the cookie; the request
  // context follows it and keeps the cookie.
  await withSecret.get("/");
  const { cookies } = await withSecret.storageState({
    path: BYPASS_STATE_PATH,
  });
  await withSecret.dispose();
  // GitHub masks these in the job log, like the secret itself. CI also
  // strips them from the uploaded traces (.github/scripts/).
  if (process.env.GITHUB_ACTIONS) {
    for (const { value } of cookies) console.log(`::add-mask::${value}`);
  }

  // Check that the cookie alone gets in, as the tests will rely on it.
  const withCookie = await request.newContext({
    baseURL,
    storageState: BYPASS_STATE_PATH,
  });
  const response = await withCookie.get("/", { maxRedirects: 0 });
  await withCookie.dispose();
  if (!response.ok()) {
    throw new Error(
      `Vercel Authentication still blocks ${baseURL} (HTTP ${response.status()}). ` +
        "Check that VERCEL_AUTOMATION_BYPASS_SECRET is the project's current " +
        "Protection Bypass for Automation secret."
    );
  }
}
