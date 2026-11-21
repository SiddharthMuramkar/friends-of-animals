import { expect, test, type Page } from "@playwright/test";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshPhone, readCode } from "./support/mailbox";

// #58: sign up and sign in by SMS code. Previews switch SMS on and capture
// every text, so the code is read from the preview's capture mailbox. Each
// test uses its own number, so runs and projects don't share codes or the
// 5-codes-per-phone limit. Seeded member1 signing in by phone, the SMS-off
// notice and the limits are proved at Seam 1 (staging is where SMS is off).

async function askForCode(page: Page, phone: string) {
  await page.getByRole("textbox", { name: "Mobile number" }).fill(phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.getByRole("status")).toContainText(
    `We've sent a code to ${phone}.`
  );
}

async function enterCode(page: Page, code: string, button: string) {
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: button }).click();
}

test("a visitor signs up by phone code, signs out and signs back in by phone", async ({
  page,
  request,
}) => {
  const phone = freshPhone();

  await expectRendersAccessibly(page, "/sign-up");
  await page
    .getByRole("link", { name: /Create an account with a code by text/ })
    .click();
  await expect(page).toHaveURL(/\/sign-up\/phone$/);
  await expectRendersAccessibly(page, "/sign-up/phone");
  await expectAccessibleInDark(page, "/sign-up/phone");

  await page.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  await askForCode(page, phone);
  await expectAccessible(page, "/sign-up/phone, code step");

  const signUpCode = await readCode(request, phone);
  await enterCode(page, signUpCode, "Create account");

  await expect(page).toHaveURL(/\/account\/sessions$/);
  await expect(
    page.getByText(`You're signed in as Asha Rao (${phone}).`)
  ).toBeVisible();

  await page
    .getByRole("region", { name: "Signed in on" })
    .getByRole("listitem")
    .filter({ hasText: "This device" })
    .getByRole("button", { name: /^Sign out/ })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByRole("link", { name: /Sign in with a code by text/ }).click();
  await expect(page).toHaveURL(/\/sign-in\/phone$/);
  await askForCode(page, phone);
  await enterCode(page, await readCode(request, phone, signUpCode), "Sign in");
  await expect(page).toHaveURL(/\/account\/sessions$/);
});

test("the phone sign-in page renders accessibly, light and dark", async ({
  page,
}) => {
  await expectRendersAccessibly(page, "/sign-in/phone");
  await expectAccessibleInDark(page, "/sign-in/phone");
});

test("a number from another country is pointed to email", async ({ page }) => {
  await page.goto("/sign-in/phone");
  await page
    .getByRole("textbox", { name: "Mobile number" })
    .fill("+44 7700 900123");
  await page.getByRole("button", { name: "Text me a code" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "We can only text Indian mobile numbers for now."
  );
  await expect(
    page.getByRole("link", { name: "Use your email instead" }).first()
  ).toHaveAttribute("href", "/sign-in");
  await expectAccessible(page, "/sign-in/phone, another country");
});
