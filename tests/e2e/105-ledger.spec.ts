import { expect, test } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { signInByCode } from "./support/sign-in";

test("finance reads the ledger in both themes and finds a new entry by category", async ({
  page,
  request,
}, testInfo) => {
  await signInByCode(page, request, "ledger-finance@example.test");
  await page.goto("/admin/ledger");
  await expect(page).toHaveURL(/\/auth\/second-factor\?/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(SEED_TOTP_SECRET), new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/ledger$/);

  await expectRendersAccessibly(page, "/admin/ledger");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ledger" })
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Ledger postings" })
  ).toContainText("Online registration fees");
  await expectAccessibleInDark(page, "/admin/ledger");

  await expectRendersAccessibly(page, "/admin/ledger/accounts");
  await expect(page.getByRole("heading", { name: "Venue hire" })).toBeVisible();
  await expectAccessibleInDark(page, "/admin/ledger/accounts");

  await expectRendersAccessibly(page, "/admin/ledger/entries/new");
  await expectAccessibleInDark(page, "/admin/ledger/entries/new");
  const description = `Ledger entry ${testInfo.project.name} ${Date.now()}`;
  await page.getByRole("textbox", { name: "Description" }).fill(description);
  const debit = page.getByRole("group", { name: "Line 1", exact: true });
  await debit.getByLabel("Account").selectOption("5110");
  await debit.getByLabel("Side").selectOption("debit");
  await debit.getByLabel("Amount in rupees").fill("25.50");
  const credit = page.getByRole("group", { name: "Line 2", exact: true });
  await credit.getByLabel("Account").selectOption("1000");
  await credit.getByLabel("Side").selectOption("credit");
  await credit.getByLabel("Amount in rupees").fill("25.50");
  await page.getByRole("button", { name: "Post entry" }).click();
  await expect(page).toHaveURL(/\/admin\/ledger\/\d+$/);

  const postingPath = new URL(page.url()).pathname;
  await expectRendersAccessibly(page, postingPath);
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Posting lines" })
  ).toContainText("₹25.50");
  await expectAccessibleInDark(page, postingPath);

  await page.goto("/admin/ledger");
  await page.getByLabel("Category", { exact: true }).selectOption("5110");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/accountCode=5110/);
  await expect(
    page.getByRole("table", { name: "Ledger postings" })
  ).toContainText(description);
});
