import { expect } from "@playwright/test";
import { test } from "./support/seed-account";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  expectNoSidewaysScrollAt320,
  newDevice,
  signInByCode,
} from "./support/sign-in";
import { drainOutbox, readEmail, readCode } from "./support/mailbox";
import { SEED_AUCTIONS } from "../../src/server/seed/auctions";

test("a published competition invitation opens a private choice and actual community join", async ({
  page,
  request,
  browser,
  seedAccount,
}, info) => {
  const artist =
    info.project.name === "mobile"
      ? SEED_AUCTIONS.mobileArtist
      : SEED_AUCTIONS.artist;
  await drainOutbox(request);
  const message = await readEmail(
    request,
    artist.email,
    "Stay involved with Friends of Animals"
  );
  expect(message.text).toContain("/dashboard/invitations");
  // Follow the message as a signed-out recipient and return to the private
  // invitation list after the normal OTP authority authenticates us.
  await page.goto("/dashboard/invitations");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%2Finvitations/);
  await page.getByRole("textbox", { name: "Email address" }).fill(artist.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(artist.email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, artist.email));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/invitations$/);
  await expect(
    page.getByRole("heading", { name: "Competition invitations" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: new RegExp(artist.name) })
  ).toBeVisible();
  await expectAccessible(page, "competition invitations");
  await expectAccessibleInDark(page, "competition invitations");
  await expectNoSidewaysScrollAt320(page, "competition invitations");
  await page
    .getByRole("button", { name: /Explore: Volunteer with FOA/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/volunteer/);
  await page.goto("/dashboard/invitations");
  await expect(
    page.getByRole("button", { name: /Continue: Volunteer with FOA/ })
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Explore: Join the FOA community/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/community/);
  await expectAccessible(page, "community continuation");
  await expectAccessibleInDark(page, "community continuation");
  await page
    .getByRole("textbox", { name: "Display name (required)" })
    .fill(artist.name);
  await page
    .getByRole("button", { name: "Join the community", exact: true })
    .click();
  await expect(page.getByText("You joined the community.")).toBeVisible();
  await page
    .getByRole("link", { name: "View your engagement timeline" })
    .click();
  await expect(
    page.getByText("Joined the FOA community", { exact: true })
  ).toBeVisible();
  await page.goto("/dashboard/invitations");
  await expect(
    page.getByRole("button", { name: /Continue: Join the FOA community/ })
  ).toBeVisible();
  await page.getByRole("button", { name: /Explore: Start a club/ }).click();
  await expect(page).toHaveURL(/\/clubs\/apply/);
  // A fresh account without consent cannot see another person's options.
  const another = await seedAccount({ name: "Uninvited member", grants: [] });
  const denied = await newDevice(browser, info);
  try {
    await signInByCode(denied, request, another);
    await denied.goto("/dashboard/invitations");
    await expect(
      denied.getByText(
        "There are no invitations available for your account right now."
      )
    ).toBeVisible();
    await expect(denied.getByRole("button", { name: /Explore:/ })).toHaveCount(
      0
    );
    await expectAccessible(denied, "uninvited account");
    await expectAccessibleInDark(denied, "uninvited account");
  } finally {
    await denied.context().close();
  }
});
