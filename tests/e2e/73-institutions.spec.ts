import { expect, test, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { freshEmail, readCode } from "./support/mailbox";

// #73: an authorised person registers an institution and sees it pending;
// an FOA staff admin opens the queue and verifies it, which gives it an
// Institution ID. Every new page is checked with axe, light and dark.

async function signIn(
  page: Page,
  request: Parameters<typeof readCode>[0],
  email: string,
  name?: string
) {
  await page.goto(name ? "/sign-up" : "/sign-in");
  if (name) await page.getByRole("textbox", { name: "Your name" }).fill(name);
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

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

test("a school registers, and FOA verifies it with an Institution ID", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const school = `E2E School ${Date.now().toString(36)}`;
  const violations = await recordCspViolations(page);
  const institutionLink = page
    .getByRole("banner")
    .getByRole("link", { name: "My institution" });

  // The authorised person: nothing registered yet.
  await signIn(page, request, freshEmail(testInfo.project.name), "Meera Iyer");
  await page.goto("/institution");
  await expect(
    page.getByRole("heading", { name: "You haven't registered an institution" })
  ).toBeVisible();
  await checkBothThemes(page, "/institution with nothing registered");

  // The form, then a refused PIN code, then a good registration.
  await page.getByRole("link", { name: "Register an institution" }).click();
  await expect(page).toHaveURL(/\/institutions\/register$/);
  await checkBothThemes(page, "/institutions/register");
  const field = (name: string) => page.getByLabel(name, { exact: true });
  await field("Name of the institution").fill(school);
  await field("How many students may take part").fill("240");
  await field("Address").fill("12 Lake Road, Sector 4");
  await field("PIN code").fill("011001");
  await field("City or town").fill("Pune");
  await field("State").fill("Maharashtra");
  await field("Office email").fill("office@example.test");
  await field("Office mobile number").fill("90000 00221");
  await field("Principal's name").fill("Seed Principal");
  await field("Principal's email").fill("principal@example.test");
  await field("Principal's mobile number").fill("90000 00222");
  await page.getByRole("button", { name: "Send for checking" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Some answers need fixing"
  );
  await expect(field("PIN code")).toHaveAttribute("aria-invalid", "true");
  await checkBothThemes(page, "/institutions/register with an error");
  await field("PIN code").fill("411001");
  await page.getByRole("button", { name: "Send for checking" }).click();

  await expect(page).toHaveURL(/\/institution\?registered=1$/);
  await expect(page.getByText("Waiting for FOA to check")).toBeVisible();
  await checkBothThemes(page, "/institution pending");
  await expect(institutionLink).toHaveCount(0);

  // FOA's staff admin, on another browser, finds it in the queue.
  const {
    baseURL,
    deviceScaleFactor,
    hasTouch,
    isMobile,
    reducedMotion,
    storageState,
    viewport,
  } = testInfo.project.use;
  const staffContext = await browser.newContext({
    baseURL,
    deviceScaleFactor,
    hasTouch,
    isMobile,
    reducedMotion,
    storageState,
    viewport,
  });
  const staff = await staffContext.newPage();
  const staffViolations = await recordCspViolations(staff);
  const staffAccount =
    testInfo.project.name === "mobile"
      ? SEED_ACCOUNTS.members[1]
      : SEED_ACCOUNTS.superAdmin;
  await signIn(staff, request, staffAccount.email);
  await staff.goto("/admin/institutions");
  await expect(staff).toHaveURL(/\/auth\/second-factor\?next=/);
  const secret = base32Decode(SEED_TOTP_SECRET);
  await staff
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await staff.getByRole("button", { name: "Continue" }).click();
  await expect(staff).toHaveURL(/\/admin\/institutions$/);

  const reviewLink = staff.getByRole("link", { name: school, exact: true });
  await expect(reviewLink).toBeVisible();
  await checkBothThemes(staff, "/admin/institutions");
  await reviewLink.click();
  await expect(staff).toHaveURL(/\/admin\/institutions\/[0-9a-f-]{36}$/);
  await expect(staff.getByRole("heading", { name: school })).toBeVisible();
  await checkBothThemes(staff, "/admin/institutions/[id]");

  // A decision needs a reason.
  await staff.getByRole("button", { name: "Verify" }).click();
  await expect(
    staff.getByText("Write a reason for this decision.")
  ).toBeVisible();
  await staff.getByLabel("Reason").fill("Checked with the principal by phone");
  await staff.getByRole("button", { name: "Verify" }).click();
  await expect(staff.getByRole("status")).toContainText(/FOA-I-[0-9A-Z]{5}/);
  await checkBothThemes(staff, "/admin/institutions/[id] verified");

  // The role is visible to the authorised person in their existing session.
  await page.goto("/");
  await institutionLink.click();
  await expect(page).toHaveURL(/\/institution$/);
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/^FOA-I-[0-9A-Z]{5}$/)).toBeVisible();
  await checkBothThemes(page, "/institution verified");
  expect(violations).toEqual([]);
  expect(staffViolations).toEqual([]);
  await staffContext.close();
});
