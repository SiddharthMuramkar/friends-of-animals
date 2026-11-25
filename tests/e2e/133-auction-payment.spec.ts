import { expect, type Page } from "@playwright/test";
import { SEED_AUCTIONS } from "../../src/server/seed/auctions";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";
import { drainOutbox, readCode, readEmail } from "./support/mailbox";
async function both(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}
async function staffSignIn(
  page: Page,
  request: Parameters<typeof signInByCode>[1],
  email: string,
  secret: Uint8Array,
  path: string
) {
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}
test("the winning buyer pays, saves a private delivery address and confirms receipt", async ({
  page,
  browser,
  request,
  seedAccount,
}, info) => {
  const mobile = info.project.name === "mobile";
  const buyer = mobile ? SEED_AUCTIONS.buyerMobile : SEED_AUCTIONS.buyer;
  const lotCode = mobile
    ? SEED_AUCTIONS.paymentOfferMobile
    : SEED_AUCTIONS.paymentOffer;
  const creatorEmail = mobile
    ? SEED_AUCTIONS.mobileArtist.email
    : SEED_AUCTIONS.otherArtist.email;
  const path = `/account/auctions/${lotCode}`;
  await drainOutbox(request);
  const mail = await readEmail(
    request,
    buyer.email,
    `Your winning bid on ${lotCode}`
  );
  expect(mail.text).toContain(path);
  await page.goto(path);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.getByRole("textbox", { name: "Email address" }).fill(buyer.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(buyer.email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, buyer.email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(
    page.getByRole("heading", { name: `Auction purchase ${lotCode}` })
  ).toBeVisible();
  await both(page, "private winning offer");
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  const checkout = page.getByRole("region", { name: "Test checkout" });
  await expect(checkout).toBeVisible();
  await both(page, "auction payment test checkout");
  await checkout.getByRole("button", { name: "Pay (test)" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment received" })
  ).toBeVisible();
  await both(page, "auction delivery address");
  const name = `Sample ${info.project.name} recipient`;
  await page.getByLabel("Recipient name (required)").fill(name);
  await page.getByLabel("Address line 1 (required)").fill("4 Fictional Street");
  await page.getByLabel("City (required)").fill("Pune");
  await page.getByLabel("Six-digit PIN code (required)").fill("411001");
  await page
    .getByLabel("State or union territory (required)")
    .selectOption("Maharashtra");
  await page.getByRole("button", { name: "Save delivery address" }).click();
  await expect(
    page.getByText("Ready for dispatch", { exact: true })
  ).toBeVisible();
  const staffPage = await newDevice(browser, info);
  try {
    const secret = generateTotpSecret();
    const email = await seedAccount({
      name: `Auction manager ${info.project.name}`,
      grants: [{ role: "auction_manager", scope: { type: "global" } }],
      totpSecret: secret,
    });
    await staffSignIn(staffPage, request, email, secret, "/admin/auctions");
    await staffPage.getByRole("link", { name: lotCode, exact: true }).click();
    await expect(
      staffPage.getByText(
        name + ", 4 Fictional Street, Pune, Maharashtra, 411001"
      )
    ).toBeVisible();
    await both(staffPage, "manager delivery");
    await staffPage
      .getByLabel("Courier", { exact: true })
      .fill("Sample courier");
    await staffPage
      .getByRole("textbox", { name: "Tracking number", exact: true })
      .fill("FAKE-133");
    await staffPage.getByRole("button", { name: "Record dispatch" }).click();
    await expect(
      staffPage.getByText("Dispatched", { exact: true })
    ).toBeVisible();
    await staffPage.getByRole("button", { name: "Mark delivered" }).click();
    await expect(
      staffPage.getByText("Delivered", { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm receipt of artwork" })
      .click();
    await expect(
      page.getByText("Receipt confirmed", { exact: true })
    ).toBeVisible();
    await both(page, "confirmed receipt");
    await staffPage.reload();
    await expect(
      staffPage.getByText("Receipt confirmed", { exact: true })
    ).toBeVisible();
    await expect(staffPage.getByText(name, { exact: false })).toHaveCount(0);
    await both(staffPage, "manager confirmed receipt");
  } finally {
    await staffPage.context().close();
  }
  await page.getByRole("link", { name: "Back to my purchases" }).click();
  await expect(
    page.getByRole("heading", { name: "My auction purchases" })
  ).toBeVisible();
  await both(page, "my auction purchases");
  await drainOutbox(request);
  const thanks = await readEmail(
    request,
    creatorEmail,
    `Thank you for contributing artwork ${lotCode}`
  );
  expect(thanks.text).not.toContain(buyer.name);
  expect(thanks.text).not.toContain(name);
});
test("finance sees the per-competition proceeds policy and may change it with step-up", async ({
  page,
  request,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `Auction finance ${info.project.name}`,
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await staffSignIn(
    page,
    request,
    email,
    secret,
    "/admin/ledger/auction-proceeds"
  );
  await expect(
    page.getByRole("heading", { name: "Auction proceeds policies" })
  ).toBeVisible();
  await both(page, "auction proceeds policy");
  const policy = page.getByRole("form", {
    name: "Art for kindness",
    exact: true,
  });
  await policy.getByLabel("Creator share (%)").fill("25.01");
  await policy.getByRole("button", { name: "Save proceeds policy" }).click();
  await expect(
    page.getByText(
      "The percentage must match the attached auction consent version."
    )
  ).toBeVisible();
  await expect(policy.getByLabel("Creator share (%)")).toHaveValue("25");
  await policy.getByRole("button", { name: "Save proceeds policy" }).click();
  await expect(page.getByText("Your changes were saved.")).toBeVisible();
  await expect(policy.getByLabel("Creator share (%)")).toHaveValue("25");
});
