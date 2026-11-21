import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail, readCode } from "./support/mailbox";

// #73: an authorised person registers an institution and sees it pending;
// an FOA staff admin opens the queue and verifies it, which gives it an
// Institution ID. Every new page is checked with axe, light and dark.

/** The seeded staff admin (src/server/seed/accounts.ts, ./access.ts). */
const STAFF_ADMIN = "member2@example.test";

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
  await expect(page.getByRole("alert")).toContainText(
    "Some answers need fixing"
  );
  await expect(field("PIN code")).toHaveAttribute("aria-invalid", "true");
  await checkBothThemes(page, "/institutions/register with an error");
  await field("PIN code").fill("411001");
  await page.getByRole("button", { name: "Send for checking" }).click();

  await expect(page).toHaveURL(/\/institution\?registered=1$/);
  await expect(page.getByText("Waiting for FOA to check")).toBeVisible();
  await checkBothThemes(page, "/institution pending");

  // FOA's staff admin, on another browser, finds it in the queue.
  const staff = await browser.newPage({
    baseURL: testInfo.project.use.baseURL,
    storageState: testInfo.project.use.storageState,
  });
  await signIn(staff, request, STAFF_ADMIN);
  await staff.goto("/admin/institutions");
  await checkBothThemes(staff, "/admin/institutions");
  await staff.getByRole("link", { name: school }).click();
  await expect(staff).toHaveURL(/\/admin\/institutions\/[0-9a-f-]{36}$/);
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

  // The authorised person sees the ID.
  await page.goto("/institution");
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/^FOA-I-[0-9A-Z]{5}$/)).toBeVisible();
  await checkBothThemes(page, "/institution verified");
});
