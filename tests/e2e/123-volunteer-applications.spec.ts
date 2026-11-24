import { expect, type Page } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { test } from "./support/seed-guardian";
import { newDevice, signInByCode } from "./support/sign-in";

// #123: an adult applies to volunteer from their dashboard, accepting both
// declarations, and a community manager approves them with their second
// factor, which makes them a volunteer; a 15-year-old whose login is linked
// to a verified guardian applies, the guardian approves on the child's
// volunteering page, and a community manager declines with a reason. Every
// page is checked with axe, light and dark. Age boundaries, the
// declarations' versions, who may do what and the races need a fake clock
// or raw rows, so Seam 1 and test:pg cover them
// (src/server/modules/volunteers/*.test.ts).

const VOLUNTEER = "/dashboard/volunteer";
const QUEUE = "/admin/volunteers";

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

/** Ticks one way to help and one time, then both declarations. */
async function fillApplication(page: Page) {
  const form = page.getByRole("form", { name: "Apply to volunteer" });
  await form.getByRole("checkbox", { name: "Technology" }).check();
  await form
    .getByRole("group", { name: "Saturday" })
    .getByRole("checkbox", { name: "Morning" })
    .check();
  await form
    .getByRole("checkbox", {
      name: "I make the safeguarding declaration above",
    })
    .check();
  await form
    .getByRole("checkbox", {
      name: "I accept the volunteer code of conduct above",
    })
    .check();
  return form;
}

/** A community manager signed in on their own device, second factor passed. */
async function communityManager(
  page: Page,
  request: Parameters<typeof signInByCode>[1],
  seedAccount: (details: {
    name: string;
    grants: { role: "community_manager"; scope: { type: "global" } }[];
    totpSecret: Uint8Array;
  }) => Promise<string>,
  name: string
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name,
    grants: [{ role: "community_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(QUEUE);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/volunteers$/);
}

test("an adult applies to volunteer and a community manager approves them", async ({
  page,
  request,
  browser,
  seedAccount,
}, testInfo) => {
  const name = `E2E Volunteer ${testInfo.project.name}`;
  const email = await seedAccount({ name, grants: [] });
  await signInByCode(page, request, email);

  await visit(page, VOLUNTEER);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Volunteer with Friends of Animals",
    })
  ).toBeVisible();
  await checkBothThemes(page, VOLUNTEER);

  // Without the declarations nothing is sent, and what was ticked stays.
  const form = page.getByRole("form", { name: "Apply to volunteer" });
  await form.getByRole("checkbox", { name: "Technology" }).check();
  await form.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Tick both boxes to accept the declarations."
  );
  await expect(
    form.getByRole("checkbox", { name: "Technology" })
  ).toBeChecked();
  await checkBothThemes(page, `${VOLUNTEER} (refused)`);

  await fillApplication(page);
  await form.getByRole("textbox", { name: "Date of birth" }).fill("1990-01-15");
  await form.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Application sent. Our community team will read it"
  );
  await expect(page.getByText("With the community team")).toBeVisible();
  await checkBothThemes(page, `${VOLUNTEER} (submitted)`);

  const staff = await newDevice(browser, testInfo);
  await communityManager(
    staff,
    request,
    seedAccount,
    `E2E Community Manager ${testInfo.project.name}`
  );
  await checkBothThemes(staff, QUEUE);
  await staff.getByRole("link", { name, exact: true }).click();
  await expect(staff).toHaveURL(/\/admin\/volunteers\/[\da-f-]+$/);
  await expect(staff.getByRole("heading", { level: 1, name })).toBeVisible();
  await checkBothThemes(staff, `${QUEUE}/[id]`);
  await staff.getByRole("button", { name: "Approve application" }).click();
  await expect(staff.getByRole("status")).toContainText(
    `Approved. ${name} now holds the volunteer role`
  );
  await expect(
    staff.getByRole("button", { name: "Approve application" })
  ).toHaveCount(0);
  await staff.context().close();

  await visit(page, VOLUNTEER);
  await expect(
    page.getByRole("heading", { name: "You're a volunteer" })
  ).toBeVisible();
  await checkBothThemes(page, `${VOLUNTEER} (approved)`);
});

test("a teen applies, their guardian approves, and a community manager declines with a reason", async ({
  page,
  request,
  browser,
  seedAccount,
  seedGuardian,
}, testInfo) => {
  const teenName = `E2E Teen ${testInfo.project.name}`;
  const { email, childIds, loginEmails } = await seedGuardian({
    name: `E2E Guardian ${testInfo.project.name}`,
    children: [{ fullName: teenName, age: 15, loginName: teenName }],
  });
  const teenEmail = loginEmails[0];
  if (!teenEmail) throw new Error("The teen has no login");
  await signInByCode(page, request, teenEmail);

  // The guardian entered the teen's date of birth: the form doesn't ask.
  await visit(page, VOLUNTEER);
  const form = await fillApplication(page);
  await expect(
    form.getByRole("textbox", { name: "Date of birth" })
  ).toHaveCount(0);
  await form.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByRole("status")).toContainText(
    "We have asked your parent or guardian to approve it"
  );
  await expect(page.getByText("Waiting for a guardian")).toBeVisible();

  const guardian = await newDevice(browser, testInfo);
  await signInByCode(guardian, request, email);
  await visit(guardian, `/guardian/children/${childIds[0]}`);
  await guardian.getByRole("link", { name: "Volunteering" }).click();
  const childPage = `/guardian/children/${childIds[0]}/volunteer`;
  await expect(guardian).toHaveURL(new RegExp(`${childPage}$`));
  await expect(
    guardian.getByRole("heading", {
      level: 1,
      name: `${teenName}'s volunteering`,
    })
  ).toBeVisible();
  await checkBothThemes(guardian, childPage);
  await guardian.getByRole("button", { name: "Approve" }).click();
  await expect(guardian.getByRole("status")).toContainText(
    `Approved. ${teenName}'s application is now with our community team.`
  );
  await checkBothThemes(guardian, `${childPage} (approved)`);
  await guardian.context().close();

  const staff = await newDevice(browser, testInfo);
  await communityManager(
    staff,
    request,
    seedAccount,
    `E2E Community Lead ${testInfo.project.name}`
  );
  await staff.getByRole("link", { name: teenName, exact: true }).click();
  await expect(staff.getByText(/approved on/)).toBeVisible();
  const reason = staff.getByRole("textbox", { name: "Why you are declining" });
  await staff.getByRole("button", { name: "Decline application" }).click();
  await expect(reason).toHaveAccessibleDescription(
    /Enter a reason of up to 500 characters/
  );
  await reason.fill("We have no openings for volunteers under 16 yet.");
  await staff.getByRole("button", { name: "Decline application" }).click();
  await expect(staff.getByRole("status")).toContainText(
    `Declined. We have told ${teenName} why.`
  );
  await staff.context().close();

  await visit(page, VOLUNTEER);
  await expect(
    page.getByText("Why: We have no openings for volunteers under 16 yet.")
  ).toBeVisible();
});
