import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { drainOutbox, readEmail } from "./support/mailbox";
import { test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";

// #126: a community manager writes a campaign for a segment, previews who
// it reaches and sends it through the outbox; the recipient's email has a
// withdrawal link that stops these messages. The segment is organisation
// representatives, a role only this journey's recipients are likely to
// hold with consent; the database is shared, so the count is read, not
// assumed.

test("a community manager sends a campaign and its recipient stops these messages by the link", async ({
  page,
  request,
  browser,
  seedAccount,
}, testInfo) => {
  // The recipient agrees to news and updates in their settings.
  const recipientEmail = await seedAccount({
    name: "Campaign Recipient",
    grants: [
      {
        role: "organisation_representative",
        scope: { type: "organisation", id: randomUUID() },
      },
    ],
  });
  const recipient = await newDevice(browser, testInfo);
  await signInByCode(recipient, request, recipientEmail);
  await recipient.goto("/account/consents");
  await recipient
    .getByRole("button", { name: "Yes, email me news and updates" })
    .click();
  await expect(recipient.getByText("You get news and updates")).toBeVisible();

  // The community manager signs in with their second factor.
  const totpSecret = generateTotpSecret();
  const managerEmail = await seedAccount({
    name: "Campaign Manager",
    grants: [{ role: "community_manager", scope: { type: "global" } }],
    totpSecret,
  });
  await signInByCode(page, request, managerEmail);
  await page.goto("/admin/campaigns");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(totpSecret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/campaigns$/);
  await expectRendersAccessibly(page, "/admin/campaigns");
  await expectAccessibleInDark(page, "/admin/campaigns");

  // Compose a draft for organisation representatives.
  await page.getByRole("link", { name: "New campaign" }).click();
  await expect(page).toHaveURL(/\/admin\/campaigns\/new$/);
  await expectAccessible(page, "/admin/campaigns/new");
  const subject = `Open day for partners ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  await page.getByRole("textbox", { name: "Subject" }).fill(subject);
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Come and meet the dogs at our shelter partners' open day.");
  await page
    .getByRole("group", { name: "People with any of these roles" })
    .getByRole("checkbox", { name: "Organisation representatives" })
    .check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByText("The draft is saved. Preview it below before sending.")
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  await expect(
    page.getByText("Roles: Organisation representatives")
  ).toBeVisible();
  await expect(
    page.getByText(/^It reaches \d+ (person|people)\.$/)
  ).toBeVisible();
  await expect(
    page.getByText(/To stop these messages, open this link:/).first()
  ).toBeVisible();
  const detail = new URL(page.url()).pathname;
  await expectAccessible(page, detail);
  await expectAccessibleInDark(page, detail);

  // Send it, confirming in the dialog.
  await page
    .getByRole("button", { name: "Send campaign", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Send campaign?" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/Send this campaign to \d+ (person|people)\?/)
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Send campaign" }).click();
  await expect(page.getByText("The campaign is on its way.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sending" })).toBeVisible();
  await expectAccessible(page, `${detail} after sending`);

  // The worker delivers; the email carries the withdrawal link.
  await drainOutbox(request);
  const email = await readEmail(request, recipientEmail, subject);
  const link = /\/withdraw\/[0-9a-f]{64}/.exec(email.text)?.[0];
  expect(link, "the withdrawal link in the email").toBeTruthy();

  // Opening the link changes nothing; the button withdraws.
  await expectRendersAccessibly(recipient, link!);
  await expectAccessibleInDark(recipient, link!);
  await expect(
    recipient.getByText(
      "Stopping withdraws your consent to news and updates from Friends of Animals."
    )
  ).toBeVisible();
  await recipient.getByRole("button", { name: "Stop these messages" }).click();
  await expect(
    recipient.getByRole("heading", {
      name: "You will not get these messages again",
    })
  ).toBeVisible();
  await expectAccessible(recipient, `${link} after withdrawing`);

  await recipient.goto("/account/consents");
  await expect(
    recipient.getByText("You don't get news and updates")
  ).toBeVisible();
  await recipient.context().close();
});
