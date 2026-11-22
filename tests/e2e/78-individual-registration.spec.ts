import { expect, type Page } from "@playwright/test";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { nonceOf, onlyPolicy, recordCspViolations } from "./support/csp";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #78: an adult takes part on their own. The chooser recommends entering
// through a school and says why; a signed-in adult registers for the
// seeded open competition from its page, is asked for a parent or guardian
// while the form says they are a minor (#81), then registers, lands on the
// pay page and sees the registration on their dashboard with their FOA
// Participant ID. Each new
// page is checked with axe, light and dark. Payment itself needs the
// gateway fake and a clock, and ages and the money rules need raw rows, so
// Seam 1 covers them (src/server/modules/participants/*.test.ts). In CI no
// gateway is configured until 77b, so paying says it isn't available yet.

/** The seeded open competition (src/server/seed/competitions.ts). */
const OPEN = {
  name: "Neighbours on My Street",
  slug: "neighbours-on-my-street",
};

const PARTICIPANT_ID = /FOA-P-\d{2}[0-9A-HJKMNP-TV-Z]{6}/;

/** Text on the page in front: not a page Next keeps mounted and hidden. */
function shown(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

test("the chooser puts the school route first, recommended, and says why", async ({
  page,
}) => {
  await expectRendersAccessibly(page, `/participate?competition=${OPEN.slug}`);
  const main = page.getByRole("main");

  const school = main.getByRole("article", {
    name: "Enter through your school",
  });
  await expect(school.getByText("Recommended")).toBeVisible();
  await expect(
    school.getByText("We encourage you to enter through your school")
  ).toBeVisible();
  await expect(
    main
      .getByRole("article", { name: "Participate as an Individual" })
      .getByRole("link", { name: "Register as an individual" })
  ).toHaveAttribute("href", `/participant/register/${OPEN.slug}`);
  await expectAccessibleInDark(page, "/participate");
});

test("an adult registers for a competition on their own and sees it on their dashboard", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "E2E Individual Adult", grants: [] });
  await signInByCode(page, request, email);

  // From the competition's page, through the chooser.
  await page.goto(`/competitions/${OPEN.slug}`);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Register as an individual" })
    .click();
  await expect(page).toHaveURL(`/participate?competition=${OPEN.slug}`);
  await page
    .getByRole("article", { name: "Participate as an Individual" })
    .getByRole("link", { name: "Register as an individual" })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: `Register for ${OPEN.name}` })
  ).toBeVisible();
  // The note, as a heading here. Next keeps the chooser mounted and
  // hidden after the click, so text checks below look at what is shown.
  await expect(
    page.getByRole("heading", {
      name: "We encourage you to enter through your school",
    })
  ).toBeVisible();
  await expect(shown(page, "Fee: ₹100.00")).toBeVisible();
  await expect(page).toHaveURL(`/participant/register/${OPEN.slug}`);
  await checkBothThemes(page, "/participant/register/[slug] blank");

  const fill = (name: string, value: string) =>
    page.getByRole("textbox", { name, exact: true }).fill(value);
  await fill("Full name", "Kavya Menon");
  await page.getByLabel("Date of birth").fill("2012-05-04");
  await fill("Mobile number", "90000 07801");
  await fill("PIN code", "411 038");
  await fill("City", "Pune");
  await fill("State", "Maharashtra");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  const register = page.getByRole("button", { name: "Register", exact: true });
  await register.click();

  // Under 18 on their own: asked who their parent or guardian is (#81).
  await expect(
    shown(page, /You're under 18\. Tell us who your parent or guardian is/)
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Your parent or guardian" })
  ).toBeVisible();
  await checkBothThemes(page, "/participant/register/[slug] under 18");

  await page.getByLabel("Date of birth").fill("1993-09-17");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await register.click();

  await expect(
    page.getByRole("heading", { level: 1, name: `Pay for ${OPEN.name}` })
  ).toBeVisible();
  await expect(shown(page, "Fee: ₹100.00")).toBeVisible();
  await checkBothThemes(page, "/participant/registrations/[id]/pay");

  // A local run pays through 77b's test checkout fallback, so the order
  // is made; the Checkout island on this page arrives with 77c.
  await page.getByRole("button", { name: "Pay ₹100.00" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Your order is ready. Online payment opens here soon; we will let you know."
  );
  await checkBothThemes(page, "/participant/registrations/[id]/pay ordered");

  await page.getByRole("link", { name: "Back to my competitions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "My competitions" })
  ).toBeVisible();
  await expect(shown(page, PARTICIPANT_ID)).toBeVisible();
  const card = page.getByRole("article", { name: OPEN.name });
  await expect(card.getByText("Waiting for payment")).toBeVisible();
  await expect(
    card.getByRole("link", { name: `Pay ₹100.00 for ${OPEN.name}` })
  ).toBeVisible();
  await checkBothThemes(page, "/participant");

  // The header now leads back to the dashboard, on every page they open.
  await page.reload();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "My competitions" })
  ).toBeVisible();
});

test("a member who hasn't registered sees an empty dashboard", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "E2E New Adult", grants: [] });
  await signInByCode(page, request, email);

  await expectRendersAccessibly(page, "/participant");
  await expect(
    page.getByText("You haven't registered for a competition yet.")
  ).toBeVisible();
  await expectAccessibleInDark(page, "/participant empty");
});

test("the register form is a signed-in page under the nonce policy, and an unknown competition's form is the 404", async ({
  page,
  request,
  seedAccount,
}) => {
  const violations = await recordCspViolations(page);
  const email = await seedAccount({ name: "E2E Careful Adult", grants: [] });
  await signInByCode(page, request, email);

  // It takes a date of birth, phone and address: a full load, so the
  // server sends the page's HTML and its policy.
  const path = `/participant/register/${OPEN.slug}`;
  const policy = await onlyPolicy(await page.goto(path), path);
  expect(nonceOf(policy), "the signed-in policy's nonce").toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  await expect(
    page.getByRole("heading", { level: 1, name: `Register for ${OPEN.name}` })
  ).toBeVisible();

  // Checked before the page renders, so the status says so too.
  const missing = await page.goto("/participant/register/no-such-competition");
  expect(missing?.status()).toBe(404);

  expect(violations).toEqual([]);
});
