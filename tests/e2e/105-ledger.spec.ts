import { expect, type APIRequestContext, type Page } from "@playwright/test";

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

const manualEntry = "/admin/ledger/entries/new";
const categories = "/admin/ledger/accounts";
const postingDate = "2026-05-01";

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

async function availableExpenseCode(page: Page, first: number) {
  const categories = await page.getByText(/^\d{4} · Expense/).allTextContents();
  const used = new Set(categories.map((category) => category.slice(0, 4)));
  // Each case and project has its own range. Read the current chart so a
  // later run on the same database also creates a fresh category.
  for (let code = first; code < first + 50; code++) {
    if (!used.has(String(code))) return String(code);
  }
  throw new Error(`No unused test category code starting at ${first}.`);
}

test("finance starts a fresh manual entry after posting", async ({
  page,
  request,
  seedAccount,
}) => {
  await signInFinanceFixture(page, request, seedAccount, "/admin/ledger");
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Ledger", exact: true }).click();
  const newEntry = page.getByRole("link", { name: "New manual entry" });
  await newEntry.focus();
  await page.keyboard.press("Enter");
  const date = page.getByLabel("Posting date (IST)");
  const description = page.getByRole("textbox", { name: "Description" });
  const defaultDate = await date.inputValue();
  await date.fill(postingDate);
  await description.fill("Finance workshop supplies");
  const debit = page.getByRole("group", { name: "Line 1", exact: true });
  await debit.getByLabel("Account").selectOption("5110");
  await debit.getByLabel("Amount in rupees").fill("25.50");
  await debit.getByLabel("Memo (optional)").fill("Workshop markers");
  const credit = page.getByRole("group", { name: "Line 2", exact: true });
  await credit.getByLabel("Account").selectOption("1000");
  await credit.getByLabel("Amount in rupees").fill("25.50");
  const submit = page.getByRole("button", { name: "Post entry" });
  const add = page.getByRole("button", { name: "Add line" });
  await credit.getByLabel("Memo (optional)").focus();
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(add).toBeFocused();
  await page.keyboard.press("Space");
  const third = page.getByRole("group", { name: "Line 3", exact: true });
  await expect(third).toBeVisible();
  await third.getByRole("button", { name: "Remove line 3" }).focus();
  await page.keyboard.press("Enter");
  await expect(third).toHaveCount(0);
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/ledger\/\d+$/);
  await page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Ledger posting #/ }) })
    .getByRole("link", { name: "Ledger", exact: true })
    .click();
  await newEntry.click();
  await expect(page).toHaveURL(new RegExp(`${manualEntry}$`));
  await expect(date).toBeVisible();
  await expect(date).toHaveValue(defaultDate);
  await expect(description).toHaveValue("");
  for (const line of [debit, credit]) {
    await expect(line.getByLabel("Account")).toHaveValue("");
    await expect(line.getByLabel("Amount in rupees")).toHaveValue("");
    await expect(line.getByLabel("Memo (optional)")).toHaveValue("");
  }
  await expect(debit.getByLabel("Side")).toHaveValue("debit");
  await expect(credit.getByLabel("Side")).toHaveValue("credit");
});

test("finance reads the ledger in both themes and finds a new entry by category", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  await signInFinanceFixture(page, request, seedAccount, "/admin/ledger");

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
  await page.getByLabel("Posting date (IST)").fill(postingDate);
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
  await page.getByLabel("From date (IST)").fill(postingDate);
  await page.getByLabel("To date (IST)").fill(postingDate);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/accountCode=5110/);
  await expect(page).toHaveURL(/from=2026-05-01&to=2026-05-01/);
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
  const reversalPath = new URL(page.url()).pathname;
  const originalLink = page.getByRole("link", { name: seq, exact: true });
  await expect(originalLink).toHaveAttribute("href", postingPath);
  await originalLink.click();
  await expect(page).toHaveURL(new RegExp(`${postingPath}$`));
  await expect(page.getByText("Reversed by")).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: reversalPath.split("/").at(-1),
      exact: true,
    })
  ).toHaveAttribute("href", reversalPath);
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
  const summary = form.getByRole("alert");
  await expect(summary).toContainText(
    "Use up to 80 characters for the public label."
  );
  await expect(summary).toBeFocused();
  await expect(form.getByLabel("Public label")).toHaveAccessibleDescription(
    "Shown on the transparency page. Use a category label, not a donor name or other personal details. Leave blank to show the public group. Use up to 80 characters for the public label."
  );
  await expect(
    page.getByRole("heading", { name: "Duplicate label test" })
  ).toHaveCount(0);
});

test("finance can correct a taken category code without re-entering the other fields", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  await signInFinanceFixture(page, request, seedAccount, categories);
  const form = page.getByRole("form", { name: "New category" });
  const availableCode = await availableExpenseCode(
    page,
    testInfo.project.name === "mobile" ? 5751 : 5701
  );
  const name = `Animal care supplies ${availableCode}`;
  const publicLabel = "Animal care";
  const code = form.getByLabel("Account code");
  const kind = form.getByLabel("Type");
  const categoryName = form.getByLabel("Name", { exact: true });
  const label = form.getByLabel("Public label");
  const group = form.getByLabel("Public group");
  const fields = [
    [code, "5100"],
    [kind, "expense"],
    [categoryName, name],
    [label, publicLabel],
    [group, "programs"],
  ] as const;
  await code.fill("5100");
  await kind.selectOption("expense");
  await categoryName.fill(name);
  await label.fill(publicLabel);
  await group.selectOption("programs");
  const submit = form.getByRole("button", { name: "Create category" });
  await submit.click();
  const summary = form.getByRole("alert");
  await expect(summary).toContainText(
    "Choose an account code that is available."
  );
  await expect(summary).toBeFocused();
  for (const [field, value] of fields) await expect(field).toHaveValue(value);

  await code.fill(availableCode);
  await submit.click();
  await expect(form.getByText("Category saved.")).toBeVisible();
  const created = page.getByRole("form", { name, exact: true });
  await expect(created).toBeVisible();
  await expect(created.getByLabel("Public label")).toHaveValue(publicLabel);
  await expect(created.getByLabel("Public group")).toHaveValue("programs");
  for (const [field] of fields) await expect(field).toHaveValue("");
});

test("category edits only save or deactivate for the matching submit intent", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  await signInFinanceFixture(page, request, seedAccount, categories);
  const code = await availableExpenseCode(
    page,
    testInfo.project.name === "mobile" ? 5851 : 5801
  );
  const name = `Supplies ${code}`;
  const updatedName = `Updated ${name}`;
  const create = page.getByRole("form", { name: "New category" });
  await create.getByLabel("Account code").fill(code);
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

test("a finance category write links to its actor in the audit log", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Ledger audit finance",
    grants: [
      { role: "finance", scope: { type: "global" } },
      { role: "staff_admin", scope: { type: "global" } },
    ],
    totpSecret: secret,
  });
  await signInStaff(page, request, email, secret, categories);
  const code = await availableExpenseCode(
    page,
    testInfo.project.name === "mobile" ? 5551 : 5501
  );
  const create = page.getByRole("form", { name: "New category" });
  await create.getByLabel("Account code").fill(code);
  await create.getByLabel("Type").selectOption("expense");
  await create
    .getByLabel("Name", { exact: true })
    .fill(`Audit supplies ${code}`);
  await create.getByLabel("Public group").selectOption("programs");
  await create.getByRole("button", { name: "Create category" }).click();
  await expect(create.getByText("Category saved.")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Admin", exact: true })
    .getByRole("link", { name: "Audit log" })
    .click();
  const entry = page
    .getByRole("listitem")
    .filter({ has: page.getByText("ledger.account_created", { exact: true }) })
    .filter({ hasText: `"code": "${code}"` });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Ledger audit finance, as Finance");
  const actorLink = entry.getByRole("link", {
    name: "Entries for this person",
  });
  await expect(actorLink).toHaveAttribute("href", /^\/admin\/audit\?person=/);
  await actorLink.click();
  await expect(page).toHaveURL(/\/admin\/audit\?person=/);
  await expect(entry).toBeVisible();
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
    await signInFinanceFixture(page, request, seedAccount, manualEntry);

    await page.getByLabel("Posting date (IST)").fill(postingDate);
    await page.getByRole("textbox", { name: "Description" }).fill("Test entry");
    const lines = [
      { account: "5100", side: "debit", amount: "25.50", memo: "Supplies" },
      { account: "1000", side: "credit", amount, memo: "Paid from bank" },
    ].map((values, index) => {
      const row = page.getByRole("group", {
        name: `Line ${index + 1}`,
        exact: true,
      });
      return {
        values,
        account: row.getByLabel("Account"),
        side: row.getByLabel("Side"),
        amount: row.getByLabel("Amount in rupees"),
        memo: row.getByLabel("Memo (optional)"),
      };
    });
    for (const line of lines) {
      await line.account.selectOption(line.values.account);
      await line.side.selectOption(line.values.side);
      await line.amount.fill(line.values.amount);
      await line.memo.fill(line.values.memo);
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
    const summary = page
      .getByRole("alert")
      .filter({ hasText: "Check the entry" });
    await expect(summary).toContainText(error);
    await expect(summary).toBeFocused();
    await expect(page.getByLabel("Posting date (IST)")).toHaveValue(
      postingDate
    );
    await expect(
      page.getByRole("textbox", { name: "Description" })
    ).toHaveValue("Test entry");
    for (const line of lines) {
      await expect(line.account).toHaveValue(line.values.account);
      await expect(line.side).toHaveValue(line.values.side);
      await expect(line.amount).toHaveValue(line.values.amount);
      await expect(line.memo).toHaveValue(line.values.memo);
    }
    if (scenario === "malformed amount grouping") {
      const amounts = page.getByLabel("Amount in rupees");
      await expect(amounts.nth(1)).toHaveAccessibleDescription(error);
      await expect(amounts.nth(1)).toHaveAttribute("aria-invalid", "true");
      await expect(amounts.nth(0)).not.toHaveAttribute("aria-invalid", "true");
      await submit.click();
      await expect(summary).toBeFocused();
    }
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
  await page.getByRole("link", { name: "Go to your dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("link", { name: "Ledger", exact: true })
  ).toHaveCount(0);
});
