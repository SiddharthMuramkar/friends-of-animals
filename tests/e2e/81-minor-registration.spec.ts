import { expect, type Page } from "@playwright/test";

import { formatIsoDate } from "../../src/server/modules/registration/domain/calendar-date";
import { bornYearsAgo as birthDateYearsAgo } from "../../src/server/seed/guardians";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, freshEmail, readEmail } from "./support/mailbox";
import { test } from "./support/seed-guardian";
import { newDevice, signInByCode } from "./support/sign-in";

// #81: a minor takes part on the individual route with a guardian. A teen
// with no guardian on the platform registers, is asked who their parent or
// guardian is, and is held until that person confirms from the link FOA
// emails them; the registration waits for participation consent before
// the guardian can pay. A
// verified guardian registers a child from the competition's register
// form. Every new state of the register form, the guardian request page
// and the dashboard is checked with axe, light and dark. Ages, refusals,
// who pays and messages to the guardian need a fake clock or raw rows, so
// Seam 1 covers them (src/server/modules/participants/register-minor.test.ts,
// pending-guardian.test.ts, src/server/modules/guardians/*.test.ts).

/** The seeded open competition (src/server/seed/competitions.ts). */
const OPEN = {
  name: "Neighbours on My Street",
  slug: "neighbours-on-my-street",
};

const SUBJECT =
  "Please confirm you are a parent or guardian on Friends of Animals";
const LINK = /\/invitations\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

/** Text on the page in front: not a page Next keeps mounted and hidden. */
function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

/**
 * The date of birth, as `<input type="date">` takes it, of someone `years`
 * old today in India, 30 days past their birthday.
 */
function bornYearsAgo(years: number): string {
  return formatIsoDate(birthDateYearsAgo(new Date(), years, 30));
}

/** Opens `path` and checks it answers below 400. */
async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

/** Fills in the contact, address and consents the register form needs. */
async function fillContact(page: Page) {
  const fill = (name: string, value: string) =>
    page.getByRole("textbox", { name, exact: true }).fill(value);
  await fill("Mobile number", "90000 08101");
  await fill("PIN code", "411 038");
  await fill("City", "Pune");
  await fill("State", "Maharashtra");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}

const register = (page: Page) =>
  page.getByRole("button", { name: "Register", exact: true }).click();

/**
 * The signed-in teen registers on their own for the open competition,
 * naming `guardianEmail` once asked; returns the request link emailed.
 */
async function teenRegisters(
  page: Page,
  request: Parameters<typeof drainOutbox>[0],
  teen: { name: string },
  guardianEmail: string,
  check?: (step: "asked" | "held") => Promise<void>
): Promise<string> {
  await visit(page, `/participant/register/${OPEN.slug}`);
  await page
    .getByRole("textbox", { name: "Full name", exact: true })
    .fill(teen.name);
  await page.getByLabel("Date of birth").fill(bornYearsAgo(15));
  await fillContact(page);
  await register(page);

  // Under 18 on their own: asked who their parent or guardian is.
  await expect(
    shown(page, /You're under 18\. Tell us who your parent or guardian is/)
  ).toBeVisible();
  const guardian = page.getByRole("group", { name: "Your parent or guardian" });
  await expect(guardian).toBeVisible();
  await check?.("asked");

  await guardian
    .getByRole("textbox", { name: "Their full name" })
    .fill("E2E Named Guardian");
  await guardian.getByLabel("They are your").selectOption("parent");
  await guardian
    .getByRole("textbox", { name: "Their email address" })
    .fill(guardianEmail);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await register(page);

  // Held: their dashboard says what it waits for.
  await expect(
    page.getByRole("heading", { level: 1, name: "My competitions" })
  ).toBeVisible();
  const card = page.getByRole("article", { name: OPEN.name });
  await expect(card.getByText("Waiting for a guardian")).toBeVisible();
  await expect(
    card.getByText(/Waiting for your parent or guardian to confirm/)
  ).toBeVisible();
  await check?.("held");

  await drainOutbox(request);
  const message = await readEmail(request, guardianEmail, SUBJECT);
  const link = LINK.exec(message.text)?.[0];
  expect(
    link,
    `the request link in the email to ${guardianEmail}`
  ).toBeTruthy();
  return link!;
}

test("a teen on their own names a parent or guardian, and is held until they confirm", async ({
  browser,
  page,
  request,
  seedAccount,
}, testInfo) => {
  const name = "E2E Teen Meera";
  const email = await seedAccount({ name, grants: [] });
  await signInByCode(page, request, email);
  const guardianEmail = freshEmail(testInfo.project.name);

  const link = await teenRegisters(
    page,
    request,
    { name },
    guardianEmail,
    async (step) =>
      checkBothThemes(
        page,
        step === "asked"
          ? "/participant/register/[slug] guardian step"
          : "/participant held for a guardian"
      )
  );

  // The teen's own account isn't the one asked.
  await visit(page, link);
  await expect(shown(page, "This request is for someone else")).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] request, someone else");

  // Signed out, whoever holds the link is asked to sign in with it.
  const visitor = await newDevice(browser, testInfo);
  await visit(visitor, link);
  await expect(
    shown(
      visitor,
      "A teen on Friends of Animals has named you as their parent or guardian."
    )
  ).toBeVisible();
  await expect(
    visitor.getByRole("main").getByRole("link", { name: "Sign in" })
  ).toBeVisible();
  await checkBothThemes(visitor, "/invitations/[token] request, signed out");
  await visitor.context().close();
});

test("the guardian a teen named confirms and gives participation consent before paying", async ({
  browser,
  page,
  request,
  seedAccount,
  seedGuardian,
}, testInfo) => {
  const { email: guardianEmail } = await seedGuardian({
    name: "E2E Guardian Lakshmi",
    children: [],
  });
  const teen = "E2E Teen Kabir";
  const teenEmail = await seedAccount({ name: teen, grants: [] });
  await signInByCode(page, request, teenEmail);
  const link = await teenRegisters(
    page,
    request,
    { name: teen },
    guardianEmail
  );

  const guardian = await newDevice(browser, testInfo);
  await signInByCode(guardian, request, guardianEmail);
  await visit(guardian, link);
  await expect(
    shown(guardian, `${teen} has named you as their parent.`)
  ).toBeVisible();
  await expect(
    shown(
      guardian,
      `Their registration for ${OPEN.name} waits until you confirm.`
    )
  ).toBeVisible();
  await checkBothThemes(guardian, "/invitations/[token] request, ready");

  await guardian
    .getByRole("button", { name: "Confirm I'm their parent or guardian" })
    .click();
  await expect(
    guardian.getByRole("heading", {
      name: "You're their parent or guardian now",
    })
  ).toBeVisible();
  await checkBothThemes(guardian, "/invitations/[token] request, accepted");

  await guardian.getByRole("link", { name: "See their registrations" }).click();
  await expect(
    guardian.getByRole("heading", { level: 1, name: "My competitions" })
  ).toBeVisible();
  const card = guardian.getByRole("article", { name: OPEN.name });
  await expect(card.getByText(`For ${teen}`)).toBeVisible();
  await expect(
    card.getByText(/waiting for a parent or guardian's consent/i)
  ).toBeVisible();
  const pay = card.getByRole("link", { name: `Pay ₹100.00 for ${OPEN.name}` });
  await expect(pay).toHaveCount(0);
  await card.getByRole("link", { name: `Manage consents for ${teen}` }).click();
  const participation = guardian.getByRole("article", {
    name: "Participation",
  });
  await participation.getByRole("button", { name: "Give consent" }).click();
  await expect(guardian.getByRole("status")).toContainText("Consent recorded.");
  await visit(guardian, "/participant");
  await expect(card.getByText("Waiting for payment")).toBeVisible();
  await expect(pay).toBeVisible();
  await checkBothThemes(guardian, "/participant a child's registration");
  await guardian.context().close();

  // The teen's own dashboard: their guardian pays.
  await visit(page, "/participant");
  await expect(
    page
      .getByRole("article", { name: OPEN.name })
      .getByText("Your parent or guardian pays the fee for this place.")
  ).toBeVisible();
});

test("an expired guardian request says so", async ({
  page,
  seedGuardianRequest,
}, testInfo) => {
  const { request } = await seedGuardianRequest({
    teenName: "E2E Teen Old Link",
    guardianEmail: freshEmail(testInfo.project.name),
    expired: true,
  });

  await visit(page, request);
  await expect(shown(page, "This request has expired")).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] request, expired");
});

test("a guardian registers their child from the competition's register form", async ({
  page,
  request,
  seedGuardian,
}) => {
  const child = "Zoya E2E";
  const { email, childIds } = await seedGuardian({
    name: "E2E Guardian Farah",
    children: [{ fullName: child, age: 9 }],
  });
  await signInByCode(page, request, email);

  // The child's page says where to register them.
  await visit(page, `/guardian/children/${childIds[0]}`);
  await expect(
    page.getByRole("heading", { name: "Competitions" })
  ).toBeVisible();

  await visit(page, `/participant/register/${OPEN.slug}`);
  const chooser = page.getByRole("navigation", {
    name: "Registering a child?",
  });
  await expect(chooser).toBeVisible();
  await checkBothThemes(page, "/participant/register/[slug] with children");
  await chooser.getByRole("link", { name: `Register ${child}` }).click();

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Register ${child} for ${OPEN.name}`,
    })
  ).toBeVisible();
  await expect(shown(page, new RegExp(`^${child}, born `))).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Full name", exact: true })
  ).toHaveCount(0);
  await checkBothThemes(page, "/participant/register/[slug] a child");

  await expect(
    page.getByRole("checkbox", { name: /I give permission for my child/ })
  ).not.toBeChecked();
  await expect(
    page.getByRole("link", { name: /Consent for your child to take part/ })
  ).toHaveAttribute("href", /^\/documents\/participation\/\d+$/);
  await fillContact(page);
  await register(page);
  await expect(
    page.getByRole("heading", { level: 1, name: `Pay for ${OPEN.name}` })
  ).toBeVisible();

  await visit(page, "/participant");
  const card = page.getByRole("article", { name: OPEN.name });
  await expect(card.getByText(`For ${child}`)).toBeVisible();
  await expect(card.getByText("Waiting for payment")).toBeVisible();
});
