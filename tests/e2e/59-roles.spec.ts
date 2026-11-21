import { expect, test } from "@playwright/test";

import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";
import { SEED_SCOPES } from "../../src/server/seed/scopes";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail, freshPhone } from "./support/mailbox";
import {
  expectNoSidewaysScrollAt320,
  newDevice,
  signInByCode,
  signUpByPhone,
} from "./support/sign-in";

// #59: a super admin gives a member a scoped role and takes it away, the
// audit log shows the change, a member who signed up by phone (#58) is
// found and given a role too, a member with several roles switches areas,
// and people without the role are refused or sent to sign in.
//
// Sign-in codes: each project asks for five (a fresh member by email, a
// fresh member by phone, the seeded super admin twice, the seeded
// multi-role member). A seeded address allows 5 codes in 15 minutes and 20
// a day, so one database takes one run of both projects in 15 minutes. CI
// gives each project and shard its own database, so the limit of 20 codes
// in 15 minutes per IP counts one shard's journeys. #60 adds the staff
// second factor to the grant and revoke steps.

const SCHOOL = SEED_SCOPES.institution.id;
const COORDINATOR = `Institution coordinator for institution ${SCHOOL}`;
const DENIED = "This page is for staff who manage access";
const NO_EMAIL = "No email address: signs in with a mobile number";

test("a super admin gives a member a scoped role, sees it in the audit log, then takes it away", async ({
  browser,
  page,
  request,
}, testInfo) => {
  // The member: a fresh account, on a second device.
  const memberEmail = freshEmail(testInfo.project.name);
  const memberName = "Kavya Menon";
  const member = await newDevice(browser, testInfo);
  await signInByCode(member, request, memberEmail, memberName);

  // A member's roles don't open the admin pages: no data, an explanation.
  for (const path of ["/admin/roles", "/admin/audit"]) {
    await member.goto(path);
    await expect(
      member.getByRole("heading", { level: 2, name: DENIED })
    ).toBeVisible();
    await expect(member.getByRole("search")).toHaveCount(0);
    await expectAccessible(member, `${path}, refused`);
  }

  // The super admin finds the member.
  await signInByCode(page, request, SEED_ACCOUNTS.superAdmin.email);
  await expectRendersAccessibly(page, "/admin/roles");
  await expectAccessibleInDark(page, "/admin/roles");
  await page
    .getByRole("searchbox", { name: "Name or email address" })
    .fill(memberEmail);
  await page.getByRole("button", { name: "Search" }).click();
  await page
    .getByRole("region", { name: "People found" })
    .getByRole("link", { name: memberEmail })
    .click();
  const roles = page.getByRole("region", { name: `Roles of ${memberName}` });
  await expect(roles.getByText(`${memberName} has no roles.`)).toBeVisible();
  const memberId = new URL(page.url()).searchParams.get("user");
  expect(memberId, "the chosen user's id in the URL").toBeTruthy();

  // A role at a scope it can't have is refused with a message, no code.
  const grantForm = page.getByRole("region", { name: "Give a role" });
  await grantForm
    .getByRole("combobox", { name: "Role" })
    .selectOption("super_admin");
  await grantForm
    .getByRole("combobox", { name: "Where it applies" })
    .selectOption("institution");
  await grantForm
    .getByRole("textbox", {
      name: "Institution, competition or organisation id",
    })
    .fill(SCHOOL);
  await grantForm.getByRole("button", { name: "Give role" }).click();
  await expect(grantForm.getByRole("alert")).toContainText(
    "That role can't apply there."
  );
  await expect(grantForm.getByRole("alert")).not.toContainText(
    "scope_not_allowed"
  );
  // What was entered stays, so only the role needs changing.
  await expect(
    grantForm.getByRole("combobox", { name: "Where it applies" })
  ).toHaveValue("institution");
  await expectAccessible(page, "/admin/roles, a refused grant");

  // Institution coordinator at the seeded institution: listed at once.
  await grantForm
    .getByRole("combobox", { name: "Role" })
    .selectOption("institution_coordinator");
  await grantForm.getByRole("button", { name: "Give role" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Role given." })
  ).toBeVisible();
  const coordinator = roles
    .getByRole("listitem")
    .filter({ hasText: COORDINATOR });
  await expect(coordinator).toContainText("by Seed Super Admin");
  // The form starts afresh: the earlier refusal is gone.
  await expect(grantForm.getByRole("alert")).toHaveCount(0);
  await expect(grantForm.getByRole("combobox", { name: "Role" })).toHaveValue(
    ""
  );
  await expectAccessible(page, "/admin/roles with a grant");
  await expectAccessibleInDark(page, "/admin/roles with a grant");
  await expectNoSidewaysScrollAt320(page, "/admin/roles with a grant");
  const rolesUrl = page.url();

  // The member's access changes straight away: a new dashboard area.
  await member.goto("/dashboard");
  await expect(
    member
      .getByRole("navigation", { name: "Your areas" })
      .getByRole("link", { name: `Institution ${SCHOOL}` })
  ).toBeVisible();

  // The audit log has the grant, by whom, when (IST) and before → after.
  await roles
    .getByRole("link", {
      name: `See changes to ${memberName}'s account in the audit log`,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/admin/audit\\?person=${memberId}`));
  const entries = page
    .getByRole("region", { name: "Entries" })
    .locator("ol > li");
  const granted = entries.filter({ hasText: "role.granted" });
  await expect(granted).toHaveCount(1);
  await expect(granted).toContainText("Seed Super Admin, as Super admin");
  await expect(granted).toContainText(
    /\d{1,2} [A-Z][a-z]+ \d{4} at \d{1,2}:\d{2} [ap]m IST/
  );
  await expect(granted).toContainText("BeforeNo roles");
  await expect(granted).toContainText(`After${COORDINATOR}`);
  await expectAccessible(page, "/admin/audit");
  await expectAccessibleInDark(page, "/admin/audit");
  await expectNoSidewaysScrollAt320(page, "/admin/audit");

  // Revoke: the grant goes, and focus moves to the message.
  await page.goto(rolesUrl);
  await roles.getByRole("button", { name: `Remove ${COORDINATOR}` }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Role removed." })
  ).toBeVisible();
  await expect(coordinator).toHaveCount(0);
  await expect(page.locator(":focus")).toContainText("Role removed.");

  // One entry a page: "Older entries" keeps the filter in the URL.
  await page.goto(`/admin/audit?person=${memberId}&limit=1`);
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText("role.revoked");
  await page.getByRole("link", { name: "Older entries" }).click();
  await expect(page).toHaveURL(
    new RegExp(`person=${memberId}&cursor=[0-9a-f-]+&limit=1$`)
  );
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText("role.granted");
  await expect(page.getByRole("link", { name: "Older entries" })).toHaveCount(
    0
  );
  await expect(
    page.getByRole("link", { name: "Newest entries" })
  ).toBeVisible();

  await member.context().close();
});

test("a super admin finds a member who signed up by phone, with no email address, and gives them a role", async ({
  browser,
  page,
  request,
}, testInfo) => {
  // The member: a fresh account made by SMS code, so it has no email
  // address. Search finds it by name, so the number's last digits make the
  // name this test's own.
  const phone = freshPhone();
  const memberName = `Ravi Iyer ${phone.slice(-5)}`;
  const member = await newDevice(browser, testInfo);
  await signUpByPhone(member, request, phone, memberName);
  await member.context().close();

  await signInByCode(page, request, SEED_ACCOUNTS.superAdmin.email);
  await page.goto("/admin/roles");
  await page
    .getByRole("searchbox", { name: "Name or email address" })
    .fill(memberName);
  await page.getByRole("button", { name: "Search" }).click();
  // Where an email address would be, a note says there isn't one.
  const found = page
    .getByRole("region", { name: "People found" })
    .getByRole("link", { name: memberName });
  await expect(found).toContainText(NO_EMAIL);
  await found.click();
  const roles = page.getByRole("region", { name: `Roles of ${memberName}` });
  await expect(roles.getByText(NO_EMAIL)).toBeVisible();
  await expect(roles.getByText(`${memberName} has no roles.`)).toBeVisible();
  await expectAccessible(page, "/admin/roles, a member with no email address");

  // Their roles are managed like anyone's.
  const grantForm = page.getByRole("region", { name: "Give a role" });
  await grantForm
    .getByRole("combobox", { name: "Role" })
    .selectOption("institution_coordinator");
  await grantForm
    .getByRole("combobox", { name: "Where it applies" })
    .selectOption("institution");
  await grantForm
    .getByRole("textbox", {
      name: "Institution, competition or organisation id",
    })
    .fill(SCHOOL);
  await grantForm.getByRole("button", { name: "Give role" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Role given." })
  ).toBeVisible();
  await expect(
    roles.getByRole("listitem").filter({ hasText: COORDINATOR })
  ).toContainText("by Seed Super Admin");
});

test("a member with several roles switches between their areas", async ({
  page,
  request,
}) => {
  await signInByCode(page, request, SEED_ACCOUNTS.members[0].email);
  await expectRendersAccessibly(page, "/dashboard");
  await expectAccessibleInDark(page, "/dashboard");
  await expectNoSidewaysScrollAt320(page, "/dashboard");

  // Signed in, the header links the dashboard (on public pages it can't
  // know, and stays static).
  await expect(
    page.locator('header a[href="/dashboard"]').first()
  ).toBeAttached();

  const areas = page
    .getByRole("navigation", { name: "Your areas" })
    .getByRole("link");
  await expect(areas).toHaveText([
    "Member",
    "Admin",
    `Institution ${SCHOOL}`,
    "Judging",
  ]);
  for (const [name, section] of [
    ["Member", "member"],
    ["Admin", "admin"],
    [`Institution ${SCHOOL}`, `institution-${SCHOOL}`],
    ["Judging", "judge"],
  ]) {
    await page
      .getByRole("navigation", { name: "Your areas" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/dashboard#${section}$`));
    await expect(
      page
        .getByRole("region", { name, exact: true })
        .getByRole("heading", { name, exact: true })
    ).toBeInViewport();
  }
});

test("a visitor who opens an admin page or the dashboard is sent to sign in", async ({
  page,
}) => {
  for (const path of ["/admin/roles", "/admin/audit", "/dashboard"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/sign-in$/);
  }
});
