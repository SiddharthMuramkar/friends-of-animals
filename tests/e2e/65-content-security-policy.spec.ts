import { expect, test } from "@playwright/test";

import { themeScript } from "../../src/lib/theme";
import {
  nonceOf,
  onlyPolicy,
  recordCspViolations,
  scriptsIn,
} from "./support/csp";
import { freshEmail, readCode } from "./support/mailbox";

// #65: public pages send a CSP without a nonce, signed-in pages a strict
// nonce policy, and neither the smoke routes nor the sign-in journey hits a
// violation. Previews enforce the policy, so a violation here is a break.

// Vercel injects its toolbar into previews unless the request carries this
// header (vercel.com/docs/vercel-toolbar/managing-toolbar). It isn't part
// of the site, and the policy would block it.
test.use({ extraHTTPHeaders: { "x-vercel-skip-toolbar": "1" } });

test("/ sends the public policy, with no nonce", async ({ page }) => {
  const policy = await onlyPolicy(await page.goto("/"), "/");

  expect(policy).toContain("script-src 'self' 'unsafe-inline'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).not.toContain("'nonce-");
  expect(policy).not.toContain("'strict-dynamic'");
});

test("the smoke routes load with no CSP violation", async ({ page }) => {
  const violations = await recordCspViolations(page);

  for (const path of [
    "/",
    "/donate",
    "/safeguarding",
    "/competitions",
    "/blog",
    "/sign-in",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
  }
  // A competition page, reached the way a visitor would: in-app navigation.
  await page.goto("/competitions");
  await page.locator('main a[href^="/competitions/"]').first().click();
  await expect(page).toHaveURL(/\/competitions\/[^/]+$/);

  expect(violations).toEqual([]);
});

test("a new member signs up into a signed-in page under a nonce policy, with no CSP violation", async ({
  page,
  request,
}, testInfo) => {
  const violations = await recordCspViolations(page);
  const email = freshEmail(testInfo.project.name);

  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  const code = await readCode(request, email);
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
  await expect(
    page.getByRole("region", { name: "Signed in on" })
  ).toBeVisible();

  // A full load, so the server sends the page's HTML and its policy.
  const response = await page.reload();
  const policy = await onlyPolicy(response, "/account/sessions");
  const nonce = nonceOf(policy);
  expect(nonce, "the signed-in policy's nonce").toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/);

  const scripts = scriptsIn(await response!.text());
  expect(scripts.length, "scripts on /account/sessions").toBeGreaterThan(0);
  for (const { attributes, body } of scripts) {
    if (attributes.includes(`nonce="${nonce}"`)) continue;
    // JSON-LD is data, which script-src doesn't govern.
    if (attributes.includes('type="application/ld+json"')) continue;
    // Anything else must be the theme script, allowed by its hash.
    expect(body, `<script${attributes}> without the nonce`).toBe(themeScript);
  }
  await expect(
    page.getByRole("region", { name: "Signed in on" })
  ).toBeVisible();

  // Signed in, a path with no page is the 404, under the public policy.
  const missing = await page.goto("/account/no-such-page");
  expect(missing?.status()).toBe(404);
  const missingPolicy = await onlyPolicy(missing, "/account/no-such-page");
  expect(nonceOf(missingPolicy)).toBeUndefined();

  expect(violations).toEqual([]);
});
