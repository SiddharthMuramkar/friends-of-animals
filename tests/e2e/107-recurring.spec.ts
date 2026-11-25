import { expect, type Page } from "@playwright/test";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";

async function both(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}
test("a member authorises, receives a receipt and cancels a monthly donation", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "Monthly donor", grants: [] });
  await signInByCode(page, request, email);
  await page.goto("/donate");
  await expect(page.getByRole("link", { name: "Give monthly" })).toBeVisible();
  await both(page, "/donate monthly");
  await page.getByRole("link", { name: "Give monthly" }).click();
  await expect(
    page.getByRole("heading", { name: "My monthly donations" })
  ).toBeVisible();
  await both(page, "/dashboard/donations");
  await expect(page.getByLabel("Donor PAN")).toHaveCount(0);
  await page.getByLabel("Monthly amount (₹)").fill("1200");
  await page.getByLabel("I am 18 or over.").check();
  await page.getByLabel("This is my own money, paid from India.").check();
  await page
    .getByRole("button", { name: "Continue to mandate authorisation" })
    .click();
  await expect(page).toHaveURL(/\/donate\/checkout\/monthly\//);
  await expect(
    page.getByRole("heading", { name: "Authorise ₹1,200.00 per month" })
  ).toBeVisible();
  await both(page, "monthly checkout");
  await page.getByRole("button", { name: "Authorise monthly mandate" }).click();
  const checkout = page.getByRole("region", { name: "Test checkout" });
  await expect(checkout).toBeVisible();
  await both(page, "monthly fallback checkout");
  await checkout.getByRole("button", { name: "Pay (test)" }).click();
  await expect(page).toHaveURL(/\/dashboard\/donations\/recurring\//);
  await expect(page.getByText(/FOA-RCPT-\d{4}-\d{6}/)).toBeVisible();
  await both(page, "monthly donation detail");
  await page.getByRole("button", { name: "Cancel monthly donation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await both(page, "cancellation confirmation");
  await page
    .getByRole("button", { name: "Yes, cancel my monthly donation" })
    .click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await both(page, "cancelled monthly donation");
});
test("finance can view the recurring donation register", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Recurring finance",
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/donations/recurring");
  await expect(page).toHaveURL(/\/auth\/second-factor\?/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/donations\/recurring$/);
  await expect(
    page.getByRole("heading", { name: "Recurring donations", level: 1 })
  ).toBeVisible();
  await both(page, "finance recurring donations");
});
