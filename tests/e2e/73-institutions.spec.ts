import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { freshEmail } from "./support/mailbox";
import type { SeedAccount } from "./support/seed-account";
import { test } from "./support/seed-institution";
import { signInByCode } from "./support/sign-in";

// #73: an authorised person registers an institution and sees it pending;
// an FOA staff admin opens the queue and verifies it, which gives it an
// Institution ID; the authorised person then sees it, with their new role,
// in the session they already had. Every new page is checked with axe,
// light and dark, and no page breaks the Content Security Policy.
//
// The journey is four tests, so each fits the 30 s test budget on the
// mobile project in CI (#55); as one test it ran past it. The tests that
// start after a registration seed the pending institution and its
// authorised person (./support/seed-institution.ts) rather than filling in
// the form again, and each staff admin is seeded with an authenticator of
// their own, so the tests run in parallel, on both projects, against one
// database: an authenticator code works once.

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

/** The banner's link to the signed-in person's institution. */
function myInstitutionLink(page: Page) {
  return page.getByRole("banner").getByRole("link", { name: "My institution" });
}

/**
 * Another browser with this project's device (screen, touch, pixel ratio)
 * and bypass cookie: a second person in the same test.
 */
async function newDevice(browser: Browser, testInfo: TestInfo) {
  const {
    baseURL,
    deviceScaleFactor,
    hasTouch,
    isMobile,
    reducedMotion,
    storageState,
    viewport,
  } = testInfo.project.use;
  return browser.newContext({
    baseURL,
    deviceScaleFactor,
    hasTouch,
    isMobile,
    reducedMotion,
    storageState,
    viewport,
  });
}

/**
 * Signs in a fresh FOA admin with an authenticator of their own, opens
 * `path` and passes the second factor it asks for. Desktop signs in a
 * super admin and mobile a staff admin: both may review and decide.
 */
async function signInAsFoaAdmin(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  testInfo: TestInfo,
  path: string
) {
  const secret = generateTotpSecret();
  const role =
    testInfo.project.name === "mobile" ? "staff_admin" : "super_admin";
  const email = await seedAccount({
    name: "Seed FOA Admin",
    grants: [{ role, scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(path)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(path);
}

test("an authorised person with nothing registered is shown how to register", async ({
  page,
  request,
}, testInfo) => {
  const violations = await recordCspViolations(page);
  await signInByCode(
    page,
    request,
    freshEmail(testInfo.project.name),
    "Meera Iyer"
  );

  await page.goto("/institution");
  await expect(
    page.getByRole("heading", { name: "You haven't registered an institution" })
  ).toBeVisible();
  await checkBothThemes(page, "/institution with nothing registered");

  await page.getByRole("link", { name: "Register an institution" }).click();
  await expect(page).toHaveURL(/\/institutions\/register$/);
  await checkBothThemes(page, "/institutions/register");
  expect(violations).toEqual([]);
});

test("an authorised person fixes a refused PIN code, registers the institution and sees it pending", async ({
  page,
  request,
}, testInfo) => {
  const school = `E2E School ${Date.now().toString(36)}`;
  const violations = await recordCspViolations(page);
  await signInByCode(
    page,
    request,
    freshEmail(testInfo.project.name),
    "Meera Iyer"
  );

  // The form, then a refused PIN code, then a good registration.
  await page.goto("/institutions/register");
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
  // In <main>: Next's route announcer is an alert too.
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
  // Not an institution admin until FOA verifies it.
  await expect(myInstitutionLink(page)).toHaveCount(0);
  expect(violations).toEqual([]);
});

test("FOA's staff admin finds a pending institution in the queue and opens it", async ({
  page,
  request,
  seedAccount,
  seedPendingInstitution,
}, testInfo) => {
  const school = await seedPendingInstitution({ applicantName: "Meera Iyer" });
  const violations = await recordCspViolations(page);
  await signInAsFoaAdmin(
    page,
    request,
    seedAccount,
    testInfo,
    "/admin/institutions"
  );

  const reviewLink = page.getByRole("link", { name: school.name, exact: true });
  await expect(reviewLink).toBeVisible();
  await checkBothThemes(page, "/admin/institutions");
  await reviewLink.click();
  await expect(page).toHaveURL(`/admin/institutions/${school.id}`);
  await expect(page.getByRole("heading", { name: school.name })).toBeVisible();
  await checkBothThemes(page, "/admin/institutions/[id]");
  expect(violations).toEqual([]);
});

test("verifying needs a reason and gives an Institution ID, which the authorised person sees with their new role in the session they had", async ({
  browser,
  page,
  request,
  seedAccount,
  seedPendingInstitution,
}, testInfo) => {
  const school = await seedPendingInstitution({ applicantName: "Meera Iyer" });

  // The authorised person signs in while it is still pending.
  const violations = await recordCspViolations(page);
  await signInByCode(page, request, school.applicantEmail);
  await expect(myInstitutionLink(page)).toHaveCount(0);

  // FOA's staff admin, on another browser, opens it.
  const staffContext = await newDevice(browser, testInfo);
  const staff = await staffContext.newPage();
  const staffViolations = await recordCspViolations(staff);
  await signInAsFoaAdmin(
    staff,
    request,
    seedAccount,
    testInfo,
    `/admin/institutions/${school.id}`
  );
  await expect(staff.getByRole("heading", { name: school.name })).toBeVisible();

  // A decision needs a reason.
  await staff.getByRole("button", { name: "Verify" }).click();
  await expect(
    staff.getByText("Write a reason for this decision.")
  ).toBeVisible();
  await staff.getByLabel("Reason").fill("Checked with the principal by phone");
  await staff.getByRole("button", { name: "Verify" }).click();
  const outcome = staff.getByRole("status");
  await expect(outcome).toContainText(/FOA-I-[0-9A-Z]{5}/);
  const [institutionCode] = /FOA-I-[0-9A-Z]{5}/.exec(
    await outcome.innerText()
  )!;
  await checkBothThemes(staff, "/admin/institutions/[id] verified");

  // The role is visible to the authorised person in their existing session.
  await page.goto("/");
  await myInstitutionLink(page).click();
  await expect(page).toHaveURL(/\/institution$/);
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/^FOA-I-[0-9A-Z]{5}$/)).toHaveText(
    institutionCode!
  );
  await checkBothThemes(page, "/institution verified");
  expect(violations).toEqual([]);
  expect(staffViolations).toEqual([]);
  await staffContext.close();
});
