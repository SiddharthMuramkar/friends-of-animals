import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

const manualEntry = "/admin/ledger/entries/new";

async function signInStaff(
  page: Page,
  request: APIRequestContext,
  email: string,
  secret: Uint8Array,
  path: string
) {
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/second-factor\?/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test("finance reads the ledger in both themes and finds a new entry by category", async ({
  page,
  request,
}, testInfo) => {
  await signInStaff(
    page,
    request,
    "ledger-finance@example.test",
    base32Decode(SEED_TOTP_SECRET),
    "/admin/ledger"
  );

  await expectRendersAccessibly(page, "/admin/ledger");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ledger" })
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Admin", exact: true })
      .getByRole("link", { name: "Ledger" })
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

for (const [scenario, amount, error] of [
  [
    "malformed amount grouping",
    "12,34",
    "Enter each amount in rupees with up to two decimal places.",
  ],
  [
    "duplicate posting dates",
    "25.50",
    "Check that the form is complete and try again.",
  ],
] as const) {
  test(`manual entry refuses ${scenario}`, async ({
    page,
    request,
    seedAccount,
  }) => {
    const secret = generateTotpSecret();
    const email = await seedAccount({
      name: "Ledger test finance",
      grants: [{ role: "finance", scope: { type: "global" } }],
      totpSecret: secret,
    });
    await signInStaff(page, request, email, secret, manualEntry);

    await page.getByRole("textbox", { name: "Description" }).fill("Test entry");
    for (const [line, account] of [
      [1, "5100"],
      [2, "1000"],
    ] as const) {
      const row = page.getByRole("group", {
        name: `Line ${line}`,
        exact: true,
      });
      await row.getByLabel("Account").selectOption(account);
      await row.getByLabel("Amount in rupees").fill(amount);
    }
    const submit = page.getByRole("button", { name: "Post entry" });
    if (scenario === "duplicate posting dates") {
      await submit.evaluate((button: HTMLButtonElement) => {
        const date = document.createElement("input");
        date.type = "hidden";
        date.name = "date";
        date.value = "2000-01-01";
        button.form?.append(date);
      });
    }
    await submit.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Check the entry" })
    ).toContainText(error);
    await expect(page).toHaveURL(new RegExp(`${manualEntry}$`));
  });
}

test("staff without finance access can return to the dashboard from every ledger page", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Ledger test manager",
    grants: [{ role: "competition_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInStaff(page, request, email, secret, "/admin/ledger");

  for (const path of [
    "/admin/ledger",
    "/admin/ledger/1",
    manualEntry,
    "/admin/ledger/accounts",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Finance access required" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Go to your dashboard" })
    ).toHaveAttribute("href", "/dashboard");
  }
});
