import { expect, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, freshEmail, readEmail } from "./support/mailbox";
import { signInByCode } from "./support/sign-in";
import { test } from "./support/seed-registration";

// #75: an institution registers for a competition. The seeded coordinator
// sees the seeded registration's reference and a closed competition; the
// authorised person of a fresh verified institution registers it for the
// seeded open competition, gets its reference, and the principal is
// emailed; a member with no institution is told why the page is empty.
// Every state of the new page is checked with axe, light and dark.
// The window's edges and the refusals need a fake clock and other
// institutions' states, so Seam 1 covers them
// (src/server/modules/registration/register-institution.test.ts).

/** The seeded verified institution (src/server/seed/institutions.ts). */
const INSTITUTION = "Seed Public School";
/** Its seeded coordinator, member 1 (src/server/seed/coordinators.ts). */
const COORDINATOR = "member1@example.test";
/** The seeded open competition and the seeded registration for it. */
const OPEN = "Neighbours on My Street";
const SEEDED_REFERENCE = "NEIGH27-I-5EED1";
/** The seeded competition whose registration closed. */
const CLOSED = "Kinder Skies";
const REFERENCE = /\bNEIGH27-I-[0-9A-HJKMNP-TV-Z]{5}\b/;

// One by one, in one worker: two tests sign the seeded coordinator in, and
// two at once would read each other's sign-in codes.
test.describe.configure({ mode: "default" });

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

/** The card of the competition called `name` on the page. */
function card(page: Page, name: string) {
  return page.getByRole("article", { name });
}

test("a coordinator sees the seeded registration's reference and a closed competition", async ({
  page,
  request,
}) => {
  await signInByCode(page, request, COORDINATOR);
  await visit(page, "/dashboard");
  await page
    .getByRole("link", { name: "Register for competitions" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Competitions" })
  ).toBeVisible();
  await expect(page.getByText(`For ${INSTITUTION}`)).toBeVisible();

  const open = card(page, OPEN);
  await expect(open.getByText("Registration open")).toBeVisible();
  await expect(open.getByText(SEEDED_REFERENCE)).toBeVisible();
  await expect(open.getByRole("button")).toHaveCount(0);
  const closed = card(page, CLOSED);
  // Exact: the closing date's sentence starts with the same words.
  await expect(
    closed.getByText("Registration closed", { exact: true })
  ).toBeVisible();
  await expect(closed.getByRole("button")).toHaveCount(0);
  await checkBothThemes(page, "/institution/competitions registered");
});

test("the page says why it refused a registration", async ({
  page,
  request,
}) => {
  // The outcome the register button comes back with, here for a second
  // registration of the seeded pair.
  await signInByCode(page, request, COORDINATOR);
  await visit(page, "/institution/competitions?done=already_registered&n=1");

  await expect(
    page.getByText(
      "Your institution is already registered for that competition."
    )
  ).toBeVisible();
  await expect(page).toHaveURL(/\/institution\/competitions$/);
  await checkBothThemes(page, "/institution/competitions refused");
});

test("an authorised person registers their institution and the principal is told", async ({
  page,
  request,
  seedVerifiedInstitution,
}, testInfo) => {
  const principalEmail = freshEmail(testInfo.project.name);
  const school = await seedVerifiedInstitution({
    adminName: "E2E Authorised Person",
    principalEmail,
  });
  await signInByCode(page, request, school.adminEmail);
  await visit(page, "/institution");
  await page.getByRole("link", { name: "Register for competitions" }).click();
  await expect(page.getByText(`For ${school.name}`)).toBeVisible();
  const open = card(page, OPEN);
  await expect(open.getByText("Registration open")).toBeVisible();
  await checkBothThemes(page, "/institution/competitions open");

  await open
    .getByRole("button", { name: `Register ${school.name} for ${OPEN}` })
    .click();

  const notice = page
    .getByRole("status")
    .filter({ hasText: `${school.name} is registered for ${OPEN}.` });
  await expect(notice).toBeVisible();
  const reference = REFERENCE.exec((await notice.textContent()) ?? "")?.[0];
  expect(reference, "the reference in the notice").toBeTruthy();
  await expect(open.getByText(reference!)).toBeVisible();
  await expect(open.getByRole("button")).toHaveCount(0);
  await checkBothThemes(page, "/institution/competitions just registered");

  await drainOutbox(request);
  const email = await readEmail(
    request,
    principalEmail,
    `${school.name} is registered for ${OPEN}`
  );
  expect(email.text).toContain(reference!);
  expect(email.text).toContain("E2E Authorised Person");
});

test("a member who acts for no institution is told why there is nothing to register", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "E2E Member", grants: [] });
  await signInByCode(page, request, email);
  await visit(page, "/institution/competitions");

  await expect(
    page.getByRole("heading", { name: "No institution to register here" })
  ).toBeVisible();
  await checkBothThemes(page, "/institution/competitions no institution");
});
