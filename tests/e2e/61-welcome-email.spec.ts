import { expect, test } from "@playwright/test";

import {
  drainOutbox,
  freshEmail,
  readCode,
  readEmail,
} from "./support/mailbox";

// #61: signing up saves a welcome event with the account, and the relay
// sends the welcome email. On a preview the journey drains the outbox
// itself (POST /api/preview/drain), so it runs this PR's handlers and
// never waits on the shared VPS worker. No new page, so no page checks.

test("a new member gets a welcome email after signing up", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);

  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(
    `We've sent a code to ${email}.`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);

  await drainOutbox(request);

  const welcome = await readEmail(
    request,
    email,
    "Welcome to Friends of Animals"
  );
  expect(welcome.text).toContain("Hello Asha Rao,");
});
