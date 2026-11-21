import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { readCode } from "./mailbox";

/**
 * Another browser with this project's settings (base URL, bypass cookie,
 * screen size): a second person in the same test.
 */
export async function newDevice(browser: Browser, testInfo: TestInfo) {
  const { baseURL, storageState, userAgent, viewport } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport,
    userAgent,
    reducedMotion: "reduce",
  });
  return context.newPage();
}

/**
 * Signs in by email code, reading the code from the capture mailbox; with
 * `name`, signs up a new account instead. Either way it lands on the
 * sessions page.
 */
export async function signInByCode(
  page: Page,
  request: APIRequestContext,
  email: string,
  name?: string
) {
  await page.goto(name ? "/sign-up" : "/sign-in");
  if (name) await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  // The code is stored before this shows, so the newest code is this one.
  await expect(page.getByRole("status")).toContainText(email);
  const code = await readCode(request, email);
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page
    .getByRole("button", { name: name ? "Create account" : "Sign in" })
    .click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
}

/** The page has no sideways scroll on a 320 px wide screen. */
export async function expectNoSidewaysScrollAt320(page: Page, label: string) {
  const before = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `sideways scroll on ${label} at 320 px`
  ).toBeLessThanOrEqual(clientWidth);
  if (before) await page.setViewportSize(before);
}
