import { expect, type Page } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { test } from "./support/seed-account";
import { expectNoSidewaysScrollAt320, signInByCode } from "./support/sign-in";

const LOG = "/admin/breaches";
const SEEDED_TITLE = "Entry export emailed to the wrong school";

async function checkPage(page: Page, path: string, title: RegExp) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBe(200);
  expect(new URL(page.url()).pathname).toBe(path);
  // Request-time metadata can stream after the main content.
  await expect(page).toHaveTitle(title);
  await expectAccessible(page, path);
  await expectAccessibleInDark(page, path);
  await expectNoSidewaysScrollAt320(page, path);
}

test("breach staff open the log and record a breach through the staff pages", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Breach Log Admin",
    grants: [{ role: "staff_admin", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(LOG);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/breaches$/);

  await checkPage(page, LOG, /^Breach log ·/);
  const seeded = page.getByRole("link", { name: SEEDED_TITLE, exact: true });
  await expect(seeded).toBeVisible();
  const seededPath = await seeded.getAttribute("href");
  expect(seededPath).toMatch(/^\/admin\/breaches\/[\da-f-]+$/);
  await checkPage(page, seededPath!, /^Breach record ·/);
  await expect(page.getByRole("heading", { name: SEEDED_TITLE })).toBeVisible();
  await expect(
    page.getByText(
      "The other school confirmed in writing that they deleted the email."
    )
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark contained" })
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Back to breach log" }).click();
  const title = `Incorrect folder permissions (${testInfo.project.name})`;
  const record = page.getByRole("form", { name: "Record a breach" });
  await record.getByLabel("Breach title").fill(title);
  await record
    .getByLabel("When FOA became aware (IST)")
    .fill("2026-01-15T10:00");
  await record.getByLabel("Severity").selectOption("low");
  await record.getByLabel("Estimated people affected").fill("1");
  await record
    .getByLabel("What happened and its impact")
    .fill("One test record was briefly visible.");
  await record.getByRole("button", { name: "Record breach" }).click();
  await expect(page).toHaveURL(/\/admin\/breaches\/[\da-f-]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page
    .getByRole("textbox", { name: "Timeline note" })
    .fill("Access was removed from the folder.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(
    page.getByText("Access was removed from the folder.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark contained" }).click();
  await expect(
    page.getByRole("button", { name: "Close breach" })
  ).toBeVisible();
});
