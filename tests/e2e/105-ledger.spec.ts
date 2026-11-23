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
import { test, type SeedAccount } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

const manualEntry = "/admin/ledger/entries/new";
const categories = "/admin/ledger/accounts";

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

async function signInFinanceFixture(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  path: string
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Ledger test finance",
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInStaff(page, request, email, secret, path);
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
  await page.getByLabel("Posting date (IST)").fill("2026-05-01");
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
  const detailDate = page.locator('time[datetime="2026-05-01"]');
  await expect.soft(detailDate).toHaveText("1 May 2026");
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
  const listDate = page
    .getByRole("row")
    .filter({ hasText: description })
    .locator('time[datetime="2026-05-01"]');
  await expect(listDate).toHaveText("1 May 2026");

  await page.goto(postingPath);
  await page.getByRole("button", { name: "Reverse posting" }).click();
  const seq = postingPath.split("/").at(-1);
  await expect(
    page.getByText(`Reversal of posting ${seq}`, { exact: true })
  ).toBeVisible();
});

test("category creation refuses duplicate field values", async ({
  page,
  request,
  seedAccount,
}) => {
  await signInFinanceFixture(page, request, seedAccount, categories);
  const form = page.getByRole("form", { name: "New category" });
  await form.getByLabel("Account code").fill("5198");
  await form.getByLabel("Type").selectOption("expense");
  await form.getByLabel("Name", { exact: true }).fill("Duplicate label test");
  await form.getByLabel("Public group").selectOption("programs");
  const submit = form.getByRole("button", { name: "Create category" });
  await submit.evaluate((button: HTMLButtonElement) => {
    const label = document.createElement("input");
    label.type = "hidden";
    label.name = "publicLabel";
    label.value = "Unexpected second label";
    button.form?.append(label);
  });
  await submit.click();
  await expect(form.getByRole("alert")).toContainText(
    "Use up to 80 characters for the public label."
  );
  await expect(
    page.getByRole("heading", { name: "Duplicate label test" })
  ).toHaveCount(0);
});

test("category edits only save or deactivate for the matching submit intent", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  await signInFinanceFixture(page, request, seedAccount, categories);
  const name = `Supplies ${testInfo.project.name}`;
  const updatedName = `Updated ${name}`;
  const create = page.getByRole("form", { name: "New category" });
  await create
    .getByLabel("Account code")
    .fill(testInfo.project.name === "mobile" ? "5199" : "5197");
  await create.getByLabel("Type").selectOption("expense");
  await create.getByLabel("Name", { exact: true }).fill(name);
  await create.getByLabel("Public group").selectOption("programs");
  await create.getByRole("button", { name: "Create category" }).click();

  const form = page.getByRole("form", { name, exact: true });
  await form.getByLabel("Name", { exact: true }).fill(updatedName);
  const save = form.getByRole("button", { name: "Save category" });
  await save.evaluate((button: HTMLButtonElement) => {
    button.name = "intent";
    button.value = "unknown";
  });
  await save.click();
  await expect(form.getByRole("alert")).toContainText(
    "Check that the form is complete and try again."
  );

  await page.reload();
  await form.getByLabel("Name", { exact: true }).fill(updatedName);
  await save.click();
  const updated = page.getByRole("form", { name: updatedName });
  await expect(updated).toBeVisible();
  await updated.getByLabel("Name", { exact: true }).clear();
  await updated.getByRole("button", { name: "Deactivate category" }).click();
  await expect(
    updated.getByRole("button", { name: "Deactivate category" })
  ).toHaveCount(0);
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
