import { expect, type Page } from "@playwright/test";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #78: an adult takes part on their own. The chooser recommends entering
// through a school and says why; a signed-in adult registers for the
// seeded open competition from its page, is refused while the form says
// they are a minor, then registers, lands on the pay page and sees the
// registration on their dashboard with their FOA Participant ID. Each new
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
  ).toHaveAttribute("href", `/competitions/${OPEN.slug}/register`);
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
  await checkBothThemes(page, "/competitions/[slug]/register blank");

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

  // Under 18: the come-back pointer, on the date of birth.
  await expect(
    shown(page, /Please come back when the guardian route opens/)
  ).toBeVisible();
  await expect(page.getByLabel("Date of birth")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await checkBothThemes(page, "/competitions/[slug]/register minor");

  await page.getByLabel("Date of birth").fill("1993-09-17");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await register.click();

  await expect(
    page.getByRole("heading", { level: 1, name: `Pay for ${OPEN.name}` })
  ).toBeVisible();
  await expect(shown(page, "Fee: ₹100.00")).toBeVisible();
  await checkBothThemes(page, "/participant/registrations/[id]/pay");

  await page.getByRole("button", { name: "Pay ₹100.00" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Online payment isn't available right now."
  );
  await checkBothThemes(page, "/participant/registrations/[id]/pay refused");

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

  // The header now leads back to the dashboard.
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
