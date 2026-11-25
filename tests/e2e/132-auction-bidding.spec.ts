import { expect, type Page } from "@playwright/test";
import { SEED_AUCTIONS } from "../../src/server/seed/auctions";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, readCode, readEmail } from "./support/mailbox";
import { test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";

const path = `/auctions/${SEED_AUCTIONS.open}`;
const bidAmount = "Bid amount in rupees (required)";
const declaration =
  "I am at least 18 years old and agree to pay the amount I bid if I win this lot (required).";

async function minimum(page: Page) {
  return (await page.getByText(/^Minimum next bid:/).textContent())!
    .replace("Minimum next bid: ₹", "")
    .replaceAll(",", "");
}

async function bid(page: Page, amount: string) {
  await page.getByLabel(bidAmount).fill(amount);
  await page.getByLabel(declaration).check();
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
}

test("adults compete for a lot, see the new price without navigation, and get an outbid message", async ({
  page,
  browser,
  request,
  seedAccount,
}, info) => {
  const first = await seedAccount({
    name: `First bidder ${info.project.name}`,
    grants: [],
  });
  const second = await seedAccount({
    name: `Second bidder ${info.project.name}`,
    grants: [],
  });
  await page.goto(path);
  await expect(page.getByText("Current highest bid")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to bid" })
  ).toBeVisible();
  await expectAccessible(page, "public bidding lot");
  await expectAccessibleInDark(page, "public bidding lot");
  await page.getByRole("link", { name: "Sign in to bid" }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill(first);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(first);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, first));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(
    page.getByRole("heading", { name: "Place a bid" })
  ).toBeVisible();
  await expectAccessible(page, "signed in bidding lot");
  await expectAccessibleInDark(page, "signed in bidding lot");
  await bid(page, "0.01");
  await expect(
    page.getByText(/^Your bid is below the current minimum/)
  ).toBeVisible();
  await expectAccessible(page, "bid refused");
  await bid(page, await minimum(page));
  await expect(page.getByText("Your bid was accepted.")).toBeVisible();
  const next = await newDevice(browser, info);
  try {
    await signInByCode(next, request, second);
    await next.goto(path);
    const nextPrice = await minimum(next);
    await page.getByLabel(bidAmount).fill("1");
    await bid(next, nextPrice);
    await expect(next.getByText("Your bid was accepted.")).toBeVisible();
    await page.bringToFront();
    const formatted =
      "₹" +
      BigInt(nextPrice.replace(/\.\d{2}$/, "")).toLocaleString("en-IN") +
      (nextPrice.match(/\.\d{2}$/)?.[0] ?? ".00");
    const highest = page
      .getByText("Current highest bid", { exact: true })
      .locator("..")
      .locator("output");
    await expect(highest).toHaveText(formatted, { timeout: 15000 });
    await expect(page.getByLabel(bidAmount)).toHaveValue("1");
    await expect(
      page.getByText(`Second bidder ${info.project.name}`, { exact: true })
    ).toHaveCount(0);
  } finally {
    await next.context().close();
  }
  // Local/preview journeys use the platform's own outbox drain instead of
  // waiting for a separate worker; its email is sent before the inbox item.
  await drainOutbox(request);
  const title = `You have been outbid on ${SEED_AUCTIONS.open}`;
  const alert = await readEmail(request, first, title);
  expect(alert.text).not.toContain(`Second bidder ${info.project.name}`);
  await page.goto("/account/inbox");
  await expect(
    page.getByRole("heading", { name: title, exact: true })
  ).toBeVisible();
  await expectAccessible(page, "outbid inbox");
  await expectAccessibleInDark(page, "outbid inbox");
});
