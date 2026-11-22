import { expect, test, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { SEED_CONSENT_PUBLISHERS } from "../../src/server/seed/accounts";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { nonceOf, onlyPolicy, recordCspViolations } from "./support/csp";
import { freshEmail, readCode } from "./support/mailbox";

// #64: consent documents and consent to messages. The preview seed
// publishes version 1 of the privacy notice, the terms and the messages
// consent. Preview databases live across pushes, so a journey reads the
// current version number instead of assuming 1.

/** Signs up or in on the open page with a mailbox code. */
async function finishWithCode(
  page: Page,
  request: Parameters<typeof readCode>[0],
  email: string
) {
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page
    .getByRole("button", { name: /^(Create account|Sign in)$/ })
    .click();
}

/** The version number in a legal page's "Version N · Last updated" line. */
async function shownVersion(page: Page): Promise<number> {
  const line = page.getByText(/^Version \d+ · Last updated /);
  await expect(line).toBeVisible();
  return Number(/^Version (\d+)/.exec((await line.textContent()) ?? "")?.[1]);
}

test("the privacy and terms pages show the published version and its text", async ({
  page,
}) => {
  await expectRendersAccessibly(page, "/privacy");
  await expectAccessibleInDark(page, "/privacy");
  expect(await shownVersion(page)).toBeGreaterThanOrEqual(1);
  await expect(
    page.getByRole("heading", { name: "Who we are", level: 2 })
  ).toBeVisible();

  await expectRendersAccessibly(page, "/terms");
  await expectAccessibleInDark(page, "/terms");
  expect(await shownVersion(page)).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Terms of use"
  );
});

test("sign-up asks for consent to news and updates, unticked, and records it", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);

  await expectRendersAccessibly(page, "/sign-up");
  await expectAccessibleInDark(page, "/sign-up");
  const box = page.getByRole("checkbox", {
    name: "Email me news and updates from Friends of Animals (optional)",
  });
  await expect(box).not.toBeChecked();

  await page.getByRole("textbox", { name: "Your name" }).fill("Kabir Singh");
  await box.check();
  await finishWithCode(page, request, email);
  await expect(page).toHaveURL(/\/account\/sessions$/);

  await page.goto("/account/consents");
  await expect(page.getByText("You get news and updates")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Your history" })
      .getByRole("listitem")
      .filter({ hasText: /^Agreed to version \d+/ })
  ).toHaveCount(1);
  await expect(page.getByText(/on this website$/)).toBeVisible();
});

test("a member gives and withdraws consent in their settings", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Fatima Shaikh");
  await finishWithCode(page, request, email);
  await expect(page).toHaveURL(/\/account\/sessions$/);

  await expectRendersAccessibly(page, "/account/consents");
  await expectAccessibleInDark(page, "/account/consents");
  await expect(page.getByText("You haven't chosen yet")).toBeVisible();

  await page
    .getByRole("button", { name: "Yes, email me news and updates" })
    .click();
  // The pressed button is gone: the page says it worked, and focus moves
  // to that message.
  const given = "Done. We'll email you news and updates.";
  await expect(
    page.getByRole("status").filter({ hasText: given })
  ).toBeVisible();
  await expect(page.locator(":focus")).toContainText(given);
  await expect(page.getByText("You get news and updates")).toBeVisible();
  await expectAccessible(page, "/account/consents after giving consent");

  await page.getByRole("button", { name: "Stop news and updates" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Done. We won't email you news and updates any more.",
    })
  ).toBeVisible();
  await expect(page.getByText("You don't get news and updates")).toBeVisible();
  const history = page
    .getByRole("region", { name: "Your history" })
    .getByRole("listitem");
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText("Stopped news and updates");
  await expect(history.last()).toContainText("Agreed to version");
});

test("the consent screens link the messages consent to the privacy policy's current version", async ({
  page,
  request,
}, testInfo) => {
  // The messages consent rests on the privacy policy, a CMS page (#111):
  // both screens that ask for it link to the page, at the version it
  // shows now.
  await page.goto("/privacy");
  const version = await shownVersion(page);
  const line = `See also our privacy policy, version ${version}.`;

  await page.goto("/sign-up");
  await expect(
    page
      .getByText(line, { exact: true })
      .getByRole("link", { name: "privacy policy" })
  ).toHaveAttribute("href", "/privacy");

  await page.getByRole("textbox", { name: "Your name" }).fill("Meera Iyer");
  await finishWithCode(page, request, freshEmail(testInfo.project.name));
  await expect(page).toHaveURL(/\/account\/sessions$/);

  await page.goto("/account/consents");
  const policy = page
    .getByRole("region", { name: "What you agree to" })
    .getByText(line, { exact: true })
    .getByRole("link", { name: "privacy policy" });
  await expect(policy).toHaveAttribute("href", "/privacy");
  await policy.click();
  await expect(page).toHaveURL(/\/privacy$/);
  expect(await shownVersion(page)).toBe(version);
});

test("a staff admin publishes a new version of the messages consent", async ({
  page,
  request,
}, testInfo) => {
  // Each project signs in a different admin, so the two never share a code
  // limit. Both publish the messages consent, so each only expects a later
  // version than the one it saw.
  const admin =
    testInfo.project.name === "desktop"
      ? SEED_CONSENT_PUBLISHERS.desktop
      : SEED_CONSENT_PUBLISHERS.mobile;
  const violations = await recordCspViolations(page);

  await page.goto("/sign-in");
  await finishWithCode(page, request, admin.email);
  await expect(page).toHaveURL(/\/account\/sessions$/);

  await page.goto("/admin/consent-documents");
  await expect(page).toHaveURL(
    /\/auth\/second-factor\?next=%2Fadmin%2Fconsent-documents$/
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(SEED_TOTP_SECRET), new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/consent-documents$/);

  // Staff pages render per request under the strict nonce policy (#65).
  const policy = await onlyPolicy(
    await page.goto("/admin/consent-documents"),
    "/admin/consent-documents"
  );
  expect(nonceOf(policy), "the staff page's nonce").toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");

  await expectRendersAccessibly(page, "/admin/consent-documents");
  await expectAccessibleInDark(page, "/admin/consent-documents");
  // The privacy policy and the terms are their policy pages' text: only
  // publishing the page in the CMS publishes them (#111).
  for (const name of ["Privacy policy", "Terms of use"]) {
    await expect(
      page
        .getByRole("region", { name })
        .getByRole("button", { name: /^Publish/ })
    ).toHaveCount(0);
  }

  const card = page.getByRole("region", { name: "News and updates by email" });
  const current = card.getByText(/^Version \d+, published /);
  const before = Number(
    /^Version (\d+)/.exec((await current.textContent()) ?? "")?.[1]
  );
  // The form starts from the current version's text: preview it unchanged.
  await card.getByRole("button", { name: "Preview" }).click();
  await expect(
    card.getByRole("heading", { name: /^Preview of version \d+$/ })
  ).toBeVisible();
  await expectAccessible(page, "/admin/consent-documents with a preview");

  await card.getByRole("button", { name: /^Publish version \d+$/ }).click();
  const notice = page
    .getByRole("region", { name: "News and updates by email" })
    .getByRole("status");
  await expect(notice).toHaveText(/Published version \d+\./);
  const published = Number(
    /Published version (\d+)/.exec((await notice.textContent()) ?? "")?.[1]
  );
  expect(published).toBeGreaterThan(before);

  expect(violations).toEqual([]);
});

test("a member is refused on the consent documents page", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Rohan Das");
  await finishWithCode(page, request, freshEmail(testInfo.project.name));
  await expect(page).toHaveURL(/\/account\/sessions$/);

  await expectRendersAccessibly(page, "/admin/consent-documents");
  await expect(
    page.getByRole("heading", { name: "Only staff admins can open this page" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0);
});
