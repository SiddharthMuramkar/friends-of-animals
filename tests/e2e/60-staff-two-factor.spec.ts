import { expect, test, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { freshEmail, readCode } from "./support/mailbox";

// #60: the second factor. A new member adds an authenticator app from the
// setup key on the page; seeded staff pass the second factor and step up
// with the preview-only SEED_TOTP_SECRET. Each project signs in its own
// seeded staff account: a code works once per authenticator.
//
// These pages are signed-in pages under #65's nonce policy, which local runs
// enforce: a page left with a static shell would have its scripts blocked,
// so each journey also records CSP violations and expects none.

/** The code an authenticator app with `secret` shows `stepsAhead` steps on. */
function codeFor(secret: Uint8Array, stepsAhead = 0): string {
  return totpCode(secret, new Date(Date.now() + stepsAhead * 30_000));
}

/**
 * A well-formed code no step of drift around now accepts, with a margin
 * for the clock moving on before the server checks it.
 */
function wrongCodeFor(secret: Uint8Array): string {
  const near = [-2, -1, 0, 1, 2].map((step) => codeFor(secret, step));
  return ["000000", "111111", "222222", "333333", "444444", "555555"].find(
    (code) => !near.includes(code)
  )!;
}

async function signIn(
  page: Page,
  request: Parameters<typeof readCode>[0],
  email: string,
  intent: "sign-in" | "sign-up" = "sign-in"
) {
  await page.goto(intent === "sign-up" ? "/sign-up" : "/sign-in");
  if (intent === "sign-up") {
    await page.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  }
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  const code = await readCode(request, email);
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page
    .getByRole("button", { name: /^(Create account|Sign in)$/ })
    .click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
}

test("a member adds an authenticator app, then steps up to remove it", async ({
  page,
  request,
}, testInfo) => {
  const violations = await recordCspViolations(page);
  await signIn(page, request, freshEmail(testInfo.project.name), "sign-up");

  await expectRendersAccessibly(page, "/account/security");
  await expectAccessibleInDark(page, "/account/security, nothing added");
  await expect(
    page.getByText("You haven't added a second step yet.")
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Name it" }).first().fill("Phone");
  await page.getByRole("button", { name: "Set up an app" }).click();
  await expect(
    page.getByRole("img", { name: /QR code for adding Friends of Animals/ })
  ).toBeVisible();
  await expectAccessible(page, "/account/security, setting up an app");
  const key = await page
    .getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    .textContent();
  const secret = base32Decode(key ?? "");

  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(codeFor(secret));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toContainText("Added.");
  await expect(
    page.getByText("Authenticator app", { exact: true })
  ).toBeVisible();
  await expectAccessible(page, "/account/security, app added");
  await expectAccessibleInDark(page, "/account/security, app added");

  // Removing it needs a fresh second factor; the one from adding it still
  // counts, so it goes straight through.
  await page.getByRole("button", { name: /^Remove Phone/ }).click();
  await expect(page.getByRole("status")).toContainText("Removed.");
  expect(violations).toEqual([]);
});

test("staff pass their second factor, then step up for a sensitive change", async ({
  page,
  request,
}, testInfo) => {
  const [, ravi] = SEED_ACCOUNTS.members;
  const staff =
    testInfo.project.name === "mobile" ? ravi : SEED_ACCOUNTS.superAdmin;
  const secret = base32Decode(SEED_TOTP_SECRET);
  const violations = await recordCspViolations(page);
  await signIn(page, request, staff.email);

  await expectRendersAccessibly(
    page,
    "/auth/second-factor?next=%2Faccount%2Fsecurity"
  );
  await expectAccessibleInDark(page, "/auth/second-factor");
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(wrongCodeFor(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "didn't match"
  );

  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(codeFor(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(
    page.getByText("Seed authenticator", { exact: true })
  ).toBeVisible();

  await expectRendersAccessibly(
    page,
    "/auth/step-up?next=%2Faccount%2Fsecurity"
  );
  await expectAccessibleInDark(page, "/auth/step-up");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Confirm it's you"
  );
  // The code just used works once; the app's next one is accepted.
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(codeFor(secret, 1));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  expect(violations).toEqual([]);
});
