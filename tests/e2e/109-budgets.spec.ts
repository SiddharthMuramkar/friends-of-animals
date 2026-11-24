import { readFile } from "node:fs/promises";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { parseCsv } from "../../src/server/modules/registration/domain/csv";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test, type SeedAccount } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #109 unit 109b: finance sets a budget, reads budget versus actual, and
// downloads the accountant's export, which balances.

const budgets = "/admin/ledger/budgets";
const report = "/admin/ledger/budgets/report";
const exportPage = "/admin/ledger/export";

async function signInFinance(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  path: string
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Budget test finance",
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/second-factor\?/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test("finance sets a budget and sees it against the actuals", async ({
  page,
  request,
  seedAccount,
}) => {
  await signInFinance(page, request, seedAccount, budgets);
  await expectRendersAccessibly(page, budgets);
  await expectAccessibleInDark(page, budgets);

  await page.getByLabel("Category", { exact: true }).selectOption("5900");
  await page.getByLabel("Month", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Budget in rupees", { exact: true }).fill("12,345");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Budget saved." })
  ).toBeVisible();
  const table = page.getByRole("table", {
    name: "Budgets by category and month, in rupees",
  });
  await expect(
    table.getByRole("row").filter({ hasText: "5900 Other expenses" })
  ).toContainText("₹12,345.00");

  await page.getByRole("link", { name: "Budget versus actual" }).click();
  await expect(page).toHaveURL(/\/admin\/ledger\/budgets\/report\?/);
  const reportPath = new URL(page.url()).pathname + new URL(page.url()).search;
  await expectRendersAccessibly(page, reportPath);
  await expectAccessibleInDark(page, reportPath);
  const categories = page.getByRole("table", {
    name: "Budget versus actual by category for the months shown",
  });
  await expect(
    categories.getByRole("row").filter({ hasText: "5900 Other expenses" })
  ).toContainText("₹12,345.00");
  // The seed budgets registration fees; the sample payments are actuals.
  await expect(
    categories.getByRole("row").filter({ hasText: "4100 Registration fees" })
  ).toContainText(/On track|Off track/);
  await expect(
    page.getByRole("table", {
      name: "Income, spending and the difference by month",
    })
  ).toBeVisible();

  await page.goto(`${report}?from=2027-01&to=2026-12`);
  await expect(
    page.getByRole("alert").filter({
      hasText: "The start must be on or before the end.",
    })
  ).toBeVisible();
});

test("finance downloads the accountant's export, and it balances", async ({
  page,
  request,
  seedAccount,
}) => {
  await signInFinance(page, request, seedAccount, exportPage);
  await expectRendersAccessibly(page, exportPage);
  await expectAccessibleInDark(page, exportPage);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^foa-ledger-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/
  );
  const parsed = parseCsv(await readFile(await download.path(), "utf8"));
  if (!parsed.ok) throw new Error(`Not CSV: ${parsed.reason}`);
  const [header, ...rows] = parsed.records;
  expect(header?.slice(0, 7)).toEqual([
    "seq",
    "date_ist",
    "period",
    "account_code",
    "account_name",
    "debit_inr",
    "credit_inr",
  ]);
  const total = rows.at(-1)!;
  expect(total[0]).toBe("TOTAL");
  expect(total[5]).toBe(total[6]);
  const paise = (value: string | undefined) => Math.round(Number(value) * 100);
  const lines = rows.slice(0, -1);
  expect(lines.length).toBeGreaterThan(0);
  const debits = lines.reduce((sum, row) => sum + paise(row[5]), 0);
  const credits = lines.reduce((sum, row) => sum + paise(row[6]), 0);
  expect(debits).toBe(credits);
  expect(debits).toBe(paise(total[5]));

  await page.getByLabel("From date (IST)").fill("2026-12-31");
  await page.getByLabel("To date (IST)").fill("2026-12-01");
  await page.getByRole("button", { name: "Download CSV" }).click();
  await expect(page).toHaveURL(/error=range_reversed/);
  await expect(
    page.getByRole("alert").filter({
      hasText: "The start must be on or before the end.",
    })
  ).toBeVisible();
});

test("staff without finance access get no budget page and no export file", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Budget test admin",
    grants: [{ role: "staff_admin", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(budgets);
  await expect(page).toHaveURL(/\/auth\/second-factor\?/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${budgets}$`));
  await expect(
    page.getByRole("heading", { name: "Finance access required" })
  ).toBeVisible();

  const response = await page.request.get(
    "/admin/ledger/export.csv?from=2026-11-01&to=2026-11-30"
  );
  expect(response.status()).toBe(403);
  expect(await response.text()).toBe("");
});
