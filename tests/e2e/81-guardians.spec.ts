import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  drainOutbox,
  freshEmail,
  readCode,
  readEmail,
} from "./support/mailbox";
import { test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";

// #81: a member registers as a parent or guardian, confirms it with the
// code emailed to them, and adds a 9-year-old (a profile they manage, with
// no login) and a 15-year-old. They invite the teen to an own login by
// email; the teen opens the link signed out, creates an account with that
// address and accepts, and the guardian then sees the login linked. Every
// state of the five guardian pages and the teen's invitation page is
// checked with axe, light and dark. Expiry, code lockout, age boundaries
// and who may do what need a fake clock or raw rows, so Seam 1 covers them
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

/** Declares the signed-in member a guardian and confirms the code. */
async function registerAsGuardian(
  page: Page,
  request: APIRequestContext,
  email: string,
  name: string,
  check?: (label: string) => Promise<void>
) {
  await visit(page, "/guardian/register");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Register as a parent or guardian",
    })
  ).toBeVisible();
  await check?.("/guardian/register declaration");
  await page.getByRole("textbox", { name: "Your full name" }).fill(name);
  await page
    .getByRole("checkbox", { name: /I am 18 or older, and the parent/ })
    .check();
  await page.getByRole("button", { name: "Email me a code" }).click();

  await expect(
    page.getByRole("heading", { name: "Enter your code" })
  ).toBeVisible();
  await expect(shown(page, /We emailed a 6-digit code to/)).toBeVisible();
  await check?.("/guardian/register code step");
  const code = await readCode(request, email);
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/guardian$/);
  await expect(
    shown(page, "You're registered as a parent or guardian.")
  ).toBeVisible();
}

/** Adds a child from /guardian and lands on their page. */
async function addChild(
  page: Page,
  child: { name: string; dateOfBirth: string }
) {
  await page.getByRole("link", { name: "Add a child" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Add a child" })
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Child's full name" })
    .fill(child.name);
  await page.getByLabel("Date of birth").fill(child.dateOfBirth);
  await page.getByLabel("You are their").selectOption("parent");
  await page.getByRole("button", { name: "Add child" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: child.name })
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Child added.");
}

test("a member registers as a guardian, confirms by code and adds an under-13 and a teenager", async ({
  page,
  request,
  seedAccount,
}) => {
  const name = "E2E Guardian Sunita";
  const email = await seedAccount({ name, grants: [] });
  await signInByCode(page, request, email);

  // Not a guardian yet: the page points to registering.
  await visit(page, "/guardian");
  await expect(
    page.getByRole("link", { name: "Register as a parent or guardian" })
  ).toBeVisible();
  await checkBothThemes(page, "/guardian not registered");

  await registerAsGuardian(page, request, email, name, (label) =>
    checkBothThemes(page, label)
  );
  await expect(
    shown(page, "You haven't added any children yet.")
  ).toBeVisible();
  await checkBothThemes(page, "/guardian empty");

  // The header now leads to their children, on every page they open.
  await page.reload();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "My children" })
  ).toBeVisible();

  // An adult is refused, on the date of birth.
  await page.getByRole("link", { name: "Add a child" }).click();
  await page
    .getByRole("textbox", { name: "Child's full name" })
    .fill("Too Old");
  await page.getByLabel("Date of birth").fill(bornYearsAgo(19));
  await page.getByLabel("You are their").selectOption("parent");
  await page.getByRole("button", { name: "Add child" }).click();
  await expect(page.getByLabel("Date of birth")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await expect(
    shown(page, /This date of birth makes them 18 or older/)
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/new refused");
  await visit(page, "/guardian");

  await addChild(page, { name: "Meera E2E", dateOfBirth: bornYearsAgo(9) });
  await expect(
    shown(page, /Under 13, Meera E2E has no login of their own/)
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] under 13");

  await page.getByRole("link", { name: "Back to your children" }).click();
  await addChild(page, { name: "Arjun E2E", dateOfBirth: bornYearsAgo(15) });
  await expect(
    page.getByRole("textbox", { name: "Their email address" })
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] 13 to 17");

  await page.getByRole("link", { name: "Back to your children" }).click();
  const list = page.getByRole("main");
  await expect(
    list
      .getByRole("article", { name: "Meera E2E" })
      .getByText("You manage this profile")
  ).toBeVisible();
  await expect(
    list
      .getByRole("article", { name: "Arjun E2E" })
      .getByText("Can have own login")
  ).toBeVisible();
  await checkBothThemes(page, "/guardian with children");
});

test("a guardian invites their teenager, who accepts with their own login", async ({
  browser,
  page,
  request,
  seedAccount,
}, testInfo) => {
  const name = "E2E Guardian Lata";
  const email = await seedAccount({ name, grants: [] });
  const teenEmail = freshEmail(testInfo.project.name);
  await signInByCode(page, request, email);
  await registerAsGuardian(page, request, email, name);
  await addChild(page, { name: "Dev E2E", dateOfBirth: bornYearsAgo(15) });

  await page
    .getByRole("textbox", { name: "Their email address" })
    .fill(teenEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation sent.");
  await expect(
    shown(page, /Invitation sent to e\*\*\*@example\.test/)
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] invited");
  const childPage = new URL(page.url()).pathname;

  await drainOutbox(request);
  const message = await readEmail(request, teenEmail, SUBJECT);
  const link = LINK.exec(message.text)?.[0];
  expect(link, `the invitation link in the email to ${teenEmail}`).toBeTruthy();

  // The guardian opening it is told it's for someone else.
  await visit(page, link!);
  await expect(
    shown(page, "This invitation is for someone else")
  ).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] teen, someone else");

  // The teen opens it signed out, then signs up with the invited address.
  const teen = await newDevice(browser, testInfo);
  await visit(teen, link!);
  await expect(
    shown(
      teen,
      "Your parent or guardian has invited you to your own login on Friends of Animals."
    )
  ).toBeVisible();
  await expect(
    teen.getByRole("main").getByRole("link", { name: "Sign in" })
  ).toBeVisible();
  await checkBothThemes(teen, "/invitations/[token] teen, signed out");

  await signInByCode(teen, request, teenEmail, "Dev E2E");
  await visit(teen, link!);
  await expect(shown(teen, `${name} has invited you`)).toBeVisible();
  await checkBothThemes(teen, "/invitations/[token] teen, ready");
  await teen.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    teen.getByRole("heading", { name: "Your login is linked" })
  ).toBeVisible();
  await checkBothThemes(teen, "/invitations/[token] teen, accepted");
  await teen.context().close();

  // The guardian sees the login linked.
  await visit(page, childPage);
  await expect(
    shown(page, "Dev E2E has their own login, linked to you.")
  ).toBeVisible();
  await checkBothThemes(page, "/guardian/children/[id] linked");
});
