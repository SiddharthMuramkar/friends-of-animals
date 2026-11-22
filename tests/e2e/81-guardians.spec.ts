import { expect, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  drainOutbox,
  freshEmail,
  readCode,
  readEmail,
} from "./support/mailbox";
import { test } from "./support/seed-guardian";
import { signInByCode } from "./support/sign-in";

// #81: a member registers as a parent or guardian and confirms it with the
// code emailed to them; a verified guardian adds a 9-year-old (a profile
// they manage, with no login) and a 15-year-old, and invites the teen to an
// own login by email; the teen opens the link signed out, creates an
// account with that address and accepts, and the guardian sees the login
// linked. Every state of the five guardian pages and the teen's invitation
// page is checked with axe, light and dark, spread over tests that each
// stay short: later steps start from a guardian the fixture seeds
// (support/seed-guardian.ts). Code lockout, age boundaries and who may do
// what need a fake clock or raw rows, so Seam 1 covers them
// (src/server/modules/guardians/*.test.ts).

const SUBJECT = "Your own login on Friends of Animals";
const LINK = /\/invitations\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

/** Text on the page in front: not a page Next keeps mounted and hidden. */
function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

/** Opens `path` and checks it answers below 400 (spec 1.8). */
async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

/**
 * The date of birth, as `<input type="date">` takes it, of someone `years`
 * old today in India, 30 days past their birthday.
 */
function bornYearsAgo(years: number): string {
  const india = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const born = new Date(
    Date.UTC(
      india.getUTCFullYear() - years,
      india.getUTCMonth(),
      india.getUTCDate() - 30
    )
  );
  return born.toISOString().slice(0, 10);
}

/** Fills in the add-child form in front of the test and sends it. */
async function submitChild(
  page: Page,
  child: { name: string; dateOfBirth: string }
) {
  await page
    .getByRole("textbox", { name: "Child's full name" })
    .fill(child.name);
  await page.getByLabel("Date of birth").fill(child.dateOfBirth);
  await page.getByLabel("You are their").selectOption("parent");
  await page.getByRole("button", { name: "Add child" }).click();
}

async function addedChild(page: Page, name: string) {
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Child added.");
}

test("a member registers as a guardian and confirms it with an emailed code", async ({
  page,
  request,
  seedAccount,
}) => {
  const name = "E2E Guardian Sunita";
  const email = await seedAccount({ name, grants: [] });
  await signInByCode(page, request, email);

  // Not a guardian yet: the page points to registering.
  await visit(page, "/guardian");
  await page
    .getByRole("link", { name: "Register as a parent or guardian" })
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Register as a parent or guardian",
    })
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/register declaration");

  await page.getByRole("textbox", { name: "Your full name" }).fill(name);
  await page
    .getByRole("checkbox", { name: /I am 18 or older, and the parent/ })
    .check();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    page.getByRole("heading", { name: "Enter your code" })
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/register code step");

  const code = await readCode(request, email);
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/guardian$/);
  await expect(
    shown(page, "You haven't added any children yet.")
  ).toBeVisible();
  await checkBothThemes(page, "/guardian empty");

  // The header now leads to their children, on every page they open.
  await page.reload();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "My children" })
  ).toBeVisible();
});

test("a member who isn't a guardian is pointed to registering", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "E2E Not A Guardian", grants: [] });
  await signInByCode(page, request, email);

  await visit(page, "/guardian");
  await expect(
    page.getByRole("link", { name: "Register as a parent or guardian" })
  ).toBeVisible();
  await checkBothThemes(page, "/guardian not registered");
});

test("a guardian adds an under-13, after an adult's date of birth is refused", async ({
  page,
  request,
  seedGuardian,
}) => {
  const { email } = await seedGuardian({
    name: "E2E Guardian Asha",
    children: [],
  });
  await signInByCode(page, request, email);

  await visit(page, "/guardian/children/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Add a child" })
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/new");

  await submitChild(page, { name: "Too Old", dateOfBirth: bornYearsAgo(19) });
  await expect(page.getByLabel("Date of birth")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await expect(
    shown(page, /This date of birth makes them 18 or older/)
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/new refused");

  await submitChild(page, { name: "Meera E2E", dateOfBirth: bornYearsAgo(9) });
  await addedChild(page, "Meera E2E");
  await expect(
    shown(page, /Under 13, Meera E2E has no login of their own/)
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] under 13");
});

test("a guardian adds a teenager, who can be invited, and sees both children listed", async ({
  page,
  request,
  seedGuardian,
}) => {
  const { email } = await seedGuardian({
    name: "E2E Guardian Ravi",
    children: [{ fullName: "Meera E2E", age: 9 }],
  });
  await signInByCode(page, request, email);

  await visit(page, "/guardian/children/new");
  await submitChild(page, {
    name: "Arjun E2E",
    dateOfBirth: bornYearsAgo(15),
  });
  await addedChild(page, "Arjun E2E");
  await expect(
    page.getByRole("textbox", { name: "Their email address" })
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] 13 to 17");

  await page.getByRole("link", { name: "Back to your children" }).click();
  const main = page.getByRole("main");
  await expect(
    main
      .getByRole("article", { name: "Meera E2E" })
      .getByText("You manage this profile")
  ).toBeVisible();
  await expect(
    main
      .getByRole("article", { name: "Arjun E2E" })
      .getByText("Can have own login")
  ).toBeVisible();
  await checkBothThemes(page, "/guardian with children");
});

test("a guardian invites their teenager by email, and the link is for someone else to them", async ({
  page,
  request,
  seedGuardian,
}, testInfo) => {
  const teenEmail = freshEmail(testInfo.project.name);
  const { email, childIds } = await seedGuardian({
    name: "E2E Guardian Lata",
    children: [{ fullName: "Dev E2E", age: 15 }],
  });
  await signInByCode(page, request, email);

  await visit(page, `/guardian/children/${childIds[0]}`);
  await page
    .getByRole("textbox", { name: "Their email address" })
    .fill(teenEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation sent.");
  await expect(
    shown(page, /Invitation sent to e\*\*\*@example\.test/)
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] invited");

  await drainOutbox(request);
  const message = await readEmail(request, teenEmail, SUBJECT);
  const link = LINK.exec(message.text)?.[0];
  expect(link, `the invitation link in the email to ${teenEmail}`).toBeTruthy();
  await visit(page, link!);
  await expect(
    shown(page, "This invitation is for someone else")
  ).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] teen, someone else");
});

test("a guardian withdraws their teenager's invitation, and its link stops working", async ({
  page,
  request,
  seedGuardian,
}, testInfo) => {
  const { email, childIds, invitation } = await seedGuardian({
    name: "E2E Guardian Kiran",
    children: [{ fullName: "Tara E2E", age: 14 }],
    invite: { email: freshEmail(testInfo.project.name) },
  });
  await signInByCode(page, request, email);

  await visit(page, `/guardian/children/${childIds[0]}`);
  await page.getByRole("button", { name: "Withdraw invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation withdrawn.");
  await expect(
    page.getByRole("textbox", { name: "Their email address" })
  ).toBeVisible();

  await visit(page, invitation!);
  await expect(shown(page, "This invitation was withdrawn")).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] teen, withdrawn");
});

test("the invited teenager signs up with the invited address and accepts", async ({
  page,
  request,
  seedGuardian,
}, testInfo) => {
  const teenEmail = freshEmail(testInfo.project.name);
  const guardian = "E2E Guardian Meena";
  const { invitation } = await seedGuardian({
    name: guardian,
    children: [{ fullName: "Kabir E2E", age: 15 }],
    invite: { email: teenEmail },
  });

  await visit(page, invitation!);
  await expect(
    shown(
      page,
      "Your parent or guardian has invited you to your own login on Friends of Animals."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in" })
  ).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] teen, signed out");

  await signInByCode(page, request, teenEmail, "Kabir E2E");
  await visit(page, invitation!);
  await expect(shown(page, `${guardian} has invited you`)).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] teen, ready");

  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "Your login is linked" })
  ).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] teen, accepted");
});

test("an expired teen invitation says so", async ({
  page,
  seedGuardian,
}, testInfo) => {
  const { invitation } = await seedGuardian({
    name: "E2E Guardian Old Link",
    children: [{ fullName: "Ira E2E", age: 16 }],
    invite: { email: freshEmail(testInfo.project.name), expired: true },
  });

  await visit(page, invitation!);
  await expect(shown(page, "This invitation has expired")).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] teen, expired");
});

test("a guardian sees their teenager's own login linked", async ({
  page,
  request,
  seedGuardian,
}) => {
  const { email, childIds } = await seedGuardian({
    name: "E2E Guardian Nisha",
    children: [{ fullName: "Rohan E2E", age: 16, loginName: "Rohan E2E" }],
  });
  await signInByCode(page, request, email);

  await visit(page, "/guardian");
  await expect(
    page
      .getByRole("main")
      .getByRole("article", { name: "Rohan E2E" })
      .getByText("Own login")
  ).toBeVisible();

  await visit(page, `/guardian/children/${childIds[0]}`);
  await expect(
    shown(page, "Rohan E2E has their own login, linked to you.")
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] linked");
});
