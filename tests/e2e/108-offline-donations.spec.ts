import { expect } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, freshEmail, readEmail } from "./support/mailbox";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

const PROOF = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFioAAAAASUVORK5CYII=",
  "base64"
);

test("finance records an offline cash gift with proof, then the donor opens its numbered receipt", async ({
  page,
  request,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Offline donations finance",
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/donations/offline");
  await expect(page).toHaveURL(/\/auth\/second-factor\?/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Record offline donation" })
  ).toBeVisible();
  await expect(page.getByLabel("Donor PAN")).toHaveCount(0);
  await expectAccessible(page, "/admin/donations/offline");
  await expectAccessibleInDark(page, "/admin/donations/offline");
  const donorEmail = freshEmail(info.project.name);
  await page.getByRole("radio", { name: "Cash" }).check();
  await page.getByLabel("Payment reference").fill(`FOA/${Date.now()}`);
  await page.getByLabel("Amount (₹)").fill("750");
  await page
    .getByLabel("Donor or contact person’s full name")
    .fill("Offline donor");
  await page.getByLabel("Donor email").fill(donorEmail);
  await page
    .getByLabel("Proof of donation")
    .setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: PROOF });
  await page.getByLabel("The donor declared they are 18 or over.").check();
  await page
    .getByLabel("The donor declared this is their own Indian-source money.")
    .check();
  await page.getByRole("button", { name: "Record donation" }).click();
  await expect(page).toHaveURL(/\/admin\/donations\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Donation of ₹750.00" })
  ).toBeVisible();
  await drainOutbox(request);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open private proof" })
  ).toBeVisible();
  await expectAccessible(page, "offline donation detail");
  await expectAccessibleInDark(page, "offline donation detail");
  const message = await readEmail(
    request,
    donorEmail,
    "Thank you for your donation of ₹750.00"
  );
  const receiptPath = /(\/receipts\/[A-Za-z0-9_-]{43})/.exec(message.text)?.[1];
  expect(receiptPath).toBeDefined();
  await page.goto(receiptPath!);
  await expect(
    page.getByRole("heading", { level: 1, name: "Donation receipt" })
  ).toBeVisible();
  await expect(page.getByText("Offline donor", { exact: true })).toBeVisible();
  await expect(page.getByText("Cash", { exact: true })).toBeVisible();
  await expect(page.getByText(/FOA-RCPT-\d{4}-\d{6}/).first()).toBeVisible();
  await expect(page.getByText(/80G/)).toHaveCount(0);
  await expectAccessible(page, "offline donation receipt");
  await expectAccessibleInDark(page, "offline donation receipt");
});
