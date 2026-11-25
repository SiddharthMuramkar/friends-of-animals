import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { SEED_DONATIONS } from "../../src/server/seed/donations";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, freshEmail, readEmail } from "./support/mailbox";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #106: a guest gives ₹500 once. The donate form starts the donation, its
// checkout page pays it through the fallback gateway's test checkout (CI
// runs with APP_ENV=local and no Razorpay keys, like 77-pay-page), the
// thank-you page shows the receipt number, and the emailed 7-day link
// opens the receipt. The seeded donations (src/server/seed/donations.ts)
// show an expired link, the request form, a foreign payment returned and
// finance's pages. Every page is checked with axe, light and dark. The
// numbering, replays, refunds, the minor rule and who may see what are
// Seam 1's (src/server/modules/donations/*.test.ts).

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

const THANK_YOU_SUBJECT = "Thank you for your donation of ₹500.00";

test("a guest gives ₹500 once and opens the receipt from the emailed link", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await page.goto("/donate");
  const form = page.getByRole("heading", { level: 2, name: "Give once" });
  await expect(form).toBeVisible();
  await checkBothThemes(page, "/donate");

  await page.getByRole("radio", { name: "₹500" }).check();
  await page.getByRole("radio", { name: "Me, as a person" }).check();
  await page.getByRole("textbox", { name: "Your full name" }).fill("Asha Rao");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("checkbox", { name: "I am 18 or over." }).check();
  await page
    .getByRole("checkbox", { name: /This is my own money, paid from India/ })
    .check();
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page).toHaveURL(/\/donate\/checkout\/[0-9a-f-]{36}\?t=/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Pay ₹500.00" })
  ).toBeVisible();
  await checkBothThemes(page, "/donate/checkout/[donationId]");

  await page.getByRole("button", { name: "Pay ₹500.00" }).click();
  const checkout = page.getByRole("region", { name: "Test checkout" });
  await expect(checkout).toBeVisible();
  await checkBothThemes(page, "/donate/checkout/[donationId] test checkout");
  await checkout.getByRole("button", { name: "Pay (test)" }).click();

  await expect(page).toHaveURL(/\/donate\/thank-you\?d=/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Thank you for giving ₹500.00",
    })
  ).toBeVisible();
  await expect(page.getByText(/FOA-RCPT-\d{4}-\d{6}/)).toBeVisible();
  await checkBothThemes(page, "/donate/thank-you");

  await drainOutbox(request);
  const message = await readEmail(request, email, THANK_YOU_SUBJECT);
  const link = /(\/receipts\/[A-Za-z0-9_-]{43})/.exec(message.text)?.[1];
  expect(link, "a receipt link in the thank-you email").toBeDefined();
  await page.goto(link!);
  await expect(
    page.getByRole("heading", { level: 1, name: "Donation receipt" })
  ).toBeVisible();
  await expect(page.getByText("Asha Rao")).toBeVisible();
  await expect(page.getByText("Rupees Five Hundred Only")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print or save as PDF" })
  ).toBeVisible();
  await checkBothThemes(page, "/receipts/[token]");
});

test("an expired receipt link offers a new one, and the request form answers the same either way", async ({
  page,
}) => {
  await page.goto(`/receipts/${SEED_DONATIONS.captured.expiredReceiptToken}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "This receipt link has expired",
    })
  ).toBeVisible();
  await checkBothThemes(page, "/receipts/[token] (expired)");

  await page.getByRole("link", { name: "Ask for a new link" }).click();
  await expect(page).toHaveURL(/\/receipts\/request$/);
  await checkBothThemes(page, "/receipts/request");
  await page
    .getByRole("textbox", { name: "Email" })
    .fill("nobody@example.test");
  await page
    .getByRole("textbox", { name: "Receipt number" })
    .fill("FOA-RCPT-2627-999999");
  await page.getByRole("button", { name: "Email me a new link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If the email address and receipt number match a donation"
  );
  await checkBothThemes(page, "/receipts/request (sent)");
});

test("the seeded receipt opens by its link, and a foreign payment's thank-you explains its return", async ({
  page,
}) => {
  await page.goto(`/receipts/${SEED_DONATIONS.captured.receiptToken}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Donation receipt" })
  ).toBeVisible();
  await expect(page.getByText(SEED_DONATIONS.captured.name)).toBeVisible();

  const { donationId, checkoutToken } = SEED_DONATIONS.foreign;
  await page.goto(`/donate/thank-you?d=${donationId}&t=${checkoutToken}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "We have returned your payment",
    })
  ).toBeVisible();
  await checkBothThemes(page, "/donate/thank-you (foreign)");
});

async function signInFinance(
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

test("finance lists donations, opens one and makes a receipt link to pass on", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Donations test finance",
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInFinance(page, request, email, secret, "/admin/donations");
  await expect(
    page.getByRole("heading", { level: 1, name: "Donations" })
  ).toBeVisible();
  await checkBothThemes(page, "/admin/donations");

  await page
    .getByRole("link", {
      name: `Open the donation of ₹500.00 from ${SEED_DONATIONS.captured.name}`,
    })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Donation of ₹500.00" })
  ).toBeVisible();
  await expect(page.getByText(SEED_DONATIONS.captured.email)).toBeVisible();
  await checkBothThemes(page, "/admin/donations/[id]");

  await page.getByRole("button", { name: "Make a new link" }).click();
  const made = page.getByRole("main").getByRole("status");
  await expect(made).toContainText("New link, valid until");
  const link = await made.getByRole("link").textContent();
  expect(link).toMatch(/\/receipts\/[A-Za-z0-9_-]{43}$/);
  await checkBothThemes(page, "/admin/donations/[id] (link made)");
});
