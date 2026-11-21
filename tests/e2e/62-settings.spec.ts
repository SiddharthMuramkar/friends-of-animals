import { expect, test, type Locator, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { freshEmail, readCode } from "./support/mailbox";
import { grantGlobalRole } from "./support/roles";

// #62: runtime settings. Only a super admin opens /admin/settings; anyone
// else is sent to sign in or told why they can't. A new super admin adds a
// second factor at #60's staff gate, then changes a setting that applies
// at once and survives a reload, and is told why a value is refused.
//
// The super admin is a fresh account per test and project, given the role
// as the preview seed gives it, with an authenticator of its own: the
// seeded super admin's authenticator is #60's journey's, and a code works
// once. Settings are shared by the whole database, so the journey puts
// back the value it changed.

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

/** What a setting's card says applies now ("On", "12 hours"). */
function valueNow(card: Locator): Locator {
  return card.getByRole("definition").first();
}

async function expectNoHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll, "no horizontal scroll").toBeLessThanOrEqual(
    width.client
  );
}

test("a new super admin adds a second factor, then changes a setting", async ({
  page,
  request,
}, testInfo) => {
  const violations = await recordCspViolations(page);
  const email = freshEmail(testInfo.project.name);
  await signUp(page, request, email);
  await grantGlobalRole(email, "super_admin");

  // #60's staff gate: no second factor yet, so add an authenticator app
  // first, then come back to the settings.
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(
    /\/account\/security\?next=%2Fadmin%2Fsettings$/
  );
  await page.getByRole("textbox", { name: "Name it" }).first().fill("Phone");
  await page.getByRole("button", { name: "Set up an app" }).click();
  const key = await page
    .getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    .textContent();
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(key ?? ""), new Date()));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);

  // Every setting, with what applies now and its default.
  await expect(
    page.getByRole("heading", { name: "All settings" })
  ).toBeVisible();
  for (const label of [
    "Staff session length",
    "Sign-in codes by text message",
    "80G registration held",
    "Foreign donations (FCRA)",
  ]) {
    await expect(page.getByRole("article", { name: label })).toBeVisible();
  }
  await expectAccessible(page, "/admin/settings");
  await expectAccessibleInDark(page, "/admin/settings");

  // A change applies at once and is still there after a reload. A fresh
  // database has 80G off; a run that stopped halfway may have left it on.
  const has80G = page.getByRole("article", { name: "80G registration held" });
  const before = (await valueNow(has80G).textContent()) === "On" ? "On" : "Off";
  const after = before === "On" ? "Off" : "On";
  await has80G.getByRole("radio", { name: after }).check();
  await has80G.getByRole("button", { name: "Save" }).click();
  await expect(has80G.getByRole("status")).toContainText(
    "Saved. The new value applies now."
  );
  await expect(valueNow(has80G)).toHaveText(after);
  await page.reload();
  await expect(valueNow(has80G)).toHaveText(after);
  await expect(has80G.getByRole("radio", { name: after })).toBeChecked();

  // A value its schema refuses: the reason, in FOA's words, beside the
  // value as typed, and nothing changes.
  const hours = page.getByRole("article", { name: "Staff session length" });
  const hoursBefore = await valueNow(hours).textContent();
  const field = hours.getByRole("spinbutton", { name: "New value, in hours" });
  await field.fill("25");
  await hours.getByRole("button", { name: "Save" }).click();
  await expect(hours.getByText("Enter 24 or less.")).toBeVisible();
  await expect(field).toHaveValue("25");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expectAccessible(page, "/admin/settings, a refused value");
  await expectAccessibleInDark(page, "/admin/settings, a refused value");
  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalScroll(page);
  await page.reload();
  await expect(valueNow(hours)).toHaveText(hoursBefore ?? "");

  // Put 80G back as it was, for whatever runs next on this database.
  await has80G.getByRole("radio", { name: before }).check();
  await has80G.getByRole("button", { name: "Save" }).click();
  await expect(valueNow(has80G)).toHaveText(before);
  expect(violations).toEqual([]);
});

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
  await expectNoHorizontalScroll(page);
});
