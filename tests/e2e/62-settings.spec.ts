import { expect, test, type Page } from "@playwright/test";

import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail, readCode } from "./support/mailbox";

// #62: runtime settings. Only a super admin opens /admin/settings; anyone
// else is sent to sign in or told why they can't. The super admin's
// journey (second factor, change org.has80G, reload, refuse 25 hours)
// joins this file once #60's second-factor screens are on the branch.

async function signUp(
  page: Page,
  request: Parameters<typeof readCode>[0],
  email: string
) {
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  const code = await readCode(request, email);
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
}

test("a visitor is sent to sign in", async ({ page }) => {
  await page.goto("/admin/settings");

  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a member is told only a super admin can open settings", async ({
  page,
  request,
}, testInfo) => {
  await signUp(page, request, freshEmail(testInfo.project.name));

  await expectRendersAccessibly(page, "/admin/settings");
  await expect(
    page.getByRole("heading", { name: "Only a super admin can open settings" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expectAccessibleInDark(page, "/admin/settings, refused");

  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll, "no horizontal scroll").toBeLessThanOrEqual(
    width.client
  );
});
