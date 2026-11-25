// #110 changes the shared ledger's lock line; the dedicated CI projects
// run this spec against their own freshly migrated and seeded database.
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, freshEmail, readEmail } from "./support/mailbox";
import { test, type SeedAccount } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

async function signInFinance(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  name: string,
  path: string
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name,
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

test("a donation's receipt arrives before its locked month appears on transparency and impact", async ({
  page,
  request,
  browser,
  baseURL,
  seedAccount,
}, info) => {
  const email = freshEmail(info.project.name);
  const wallName = "Transparency supporter";
  const fullName = "Private Transparency donor";
  const month = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "long",
  }).format(new Date());

  await page.goto("/donate");
  await page.getByRole("radio", { name: "₹500" }).check();
  await page.getByRole("radio", { name: "Me, as a person" }).check();
  await page.getByRole("textbox", { name: "Your full name" }).fill(fullName);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page
    .getByRole("checkbox", { name: "Show my gift on the donor wall" })
    .check();
  await page.getByRole("textbox", { name: "Name on the wall" }).fill(wallName);
  await page.getByRole("checkbox", { name: "I am 18 or over." }).check();
  await page
    .getByRole("checkbox", { name: /This is my own money, paid from India/ })
    .check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page).toHaveURL(/\/donate\/checkout\/[0-9a-f-]{36}\?t=/);
  await page.getByRole("button", { name: "Pay ₹500.00" }).click();
  await page
    .getByRole("region", { name: "Test checkout" })
    .getByRole("button", { name: "Pay (test)" })
    .click();
  await expect(page).toHaveURL(/\/donate\/thank-you\?d=/);
  await drainOutbox(request);
  const message = await readEmail(
    request,
    email,
    "Thank you for your donation of ₹500.00"
  );
  const receipt = /(\/receipts\/[A-Za-z0-9_-]{43})/.exec(message.text)?.[1];
  expect(receipt).toBeDefined();
  await page.goto(receipt!);
  await expect(
    page.getByRole("heading", { level: 1, name: "Donation receipt" })
  ).toBeVisible();
  await expect(page.getByText(fullName, { exact: true })).toBeVisible();

  await page.goto("/transparency");
  await expect(
    page.getByRole("heading", { level: 2, name: "Financial year 2025-26" })
  ).toBeVisible();
  await expect(page.getByText(wallName, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: month, exact: true })
  ).toHaveCount(0);

  const firstContext = await browser.newContext({ baseURL });
  const secondContext = await browser.newContext({ baseURL });
  try {
    const requester = await firstContext.newPage();
    const approver = await secondContext.newPage();
    await signInFinance(
      requester,
      request,
      seedAccount,
      "Transparency finance",
      "/admin/ledger/periods"
    );
    await requester
      .getByRole("button", { name: `Ask to lock ${month}` })
      .click();
    await expect(
      requester
        .getByRole("status")
        .filter({ hasText: "Your request to lock the month is waiting" })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 2, name: "Financial year 2025-26" })
    ).toBeVisible();
    await expect(page.getByText(wallName, { exact: true })).toHaveCount(0);

    await signInFinance(
      approver,
      request,
      seedAccount,
      "Transparency approver",
      "/admin/ledger/approvals"
    );
    await approver
      .getByRole("region", { name: "Waiting for approval", exact: true })
      .getByRole("listitem")
      .filter({
        has: approver.getByRole("heading", {
          name: `Lock ${month}`,
          exact: true,
        }),
      })
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(
      approver
        .getByRole("status")
        .filter({ hasText: "Approved. The change applies now." })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: month, exact: true })
    ).toBeVisible();
    // Five seeded captured donations (₹28,250) plus today's ₹500.
    await expect(page.getByTestId("transparency-donations")).toHaveText(
      "₹28,750.00"
    );
    await expect(page.getByText(wallName, { exact: true })).toBeVisible();
    await expect(page.getByText(fullName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
    await expectAccessible(page, "/transparency");
    await expectAccessibleInDark(page, "/transparency");
    await page.goto("/impact");
    await expect(page.getByTestId("impact-funds-raised")).toHaveText(
      "₹28,750.00"
    );
    await page
      .getByRole("link", { name: "See the published accounts" })
      .click();
    await expect(page.getByTestId("transparency-donations")).toHaveText(
      "₹28,750.00"
    );
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
