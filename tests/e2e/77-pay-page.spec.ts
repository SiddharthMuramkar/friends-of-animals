import { expect, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { signInByCode } from "./support/sign-in";
import { test } from "./support/seed-registration";

// #77: an institution pays its students' fees in one payment. The
// authorised person of a fresh verified institution registers it for the
// seeded open competition, enrols two students, opens the pay page, tries
// the test checkout once and declines, then pays: the payment's page shows
// both students confirmed with their registration numbers. CI's E2E job
// runs with APP_ENV=local and no Razorpay keys, so the fallback gateway's
// test checkout stands in for Razorpay's (Razorpay test mode needs HR-09).
// Both pages are checked with axe, light and dark. The amounts, replays,
// signatures and who may pay are Seam 1's
// (src/server/modules/payments/*.test.ts, src/server/ports/*.test.ts).

/** The seeded open competition (src/server/seed/competitions.ts). */
const OPEN = "Neighbours on My Street";

// Its sample institution fee is ₹1,000 a student
// (src/server/seed/competition-terms.ts).
const TOTAL = "₹2,000";

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

async function enrol(page: Page, name: string, guardianPhone: string) {
  await page.getByRole("link", { name: "Add a student" }).click();
  const fill = (label: string, value: string) =>
    page.getByRole("textbox", { name: label, exact: true }).fill(value);
  await fill("Full name", name);
  await page.getByLabel("Date of birth").fill("2016-04-12");
  await fill("Parent or guardian's name", `Parent of ${name}`);
  await page.getByRole("radio", { name: "Parent" }).check();
  await fill("Parent or guardian's mobile number", guardianPhone);
  await page.getByRole("button", { name: "Add student" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `${name} is enrolled` })
  ).toBeVisible();
}

test("an institution pays every waiting student's fee in one payment and sees them confirmed", async ({
  page,
  request,
  seedVerifiedInstitution,
}, testInfo) => {
  const school = await seedVerifiedInstitution({
    adminName: "E2E Paying Authorised Person",
    principalEmail: freshEmail(testInfo.project.name),
  });
  await signInByCode(page, request, school.adminEmail);
  await page.goto("/institution/competitions");
  const open = page.getByRole("article", { name: OPEN });
  await open
    .getByRole("button", { name: `Register ${school.name} for ${OPEN}` })
    .click();
  await open
    .getByRole("link", { name: `Students of ${school.name} in ${OPEN}` })
    .click();
  await enrol(page, "Tara Menon", "90000 07701");
  await enrol(page, "Kabir Shah", "90000 07702");
  const reference = (
    await page.getByText(/^Registration reference /).textContent()
  )?.replace("Registration reference ", "");
  expect(reference).toMatch(/^NEIGH27-I-/);

  // A full load, as every link to the pay page is: its CSP comes with it.
  const payPath = `/institution/registrations/${reference}/pay?institution=${school.id}`;
  const response = await page.goto(payPath);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Pay fees" })
  ).toBeVisible();
  const summary = page.getByRole("region", { name: "What you pay" });
  await expect(summary).toContainText("Students waiting for their fee2");
  await expect(summary).toContainText("Fee per student₹1,000");
  await expect(summary).toContainText(`Total${TOTAL}`);
  await checkBothThemes(page, "/institution/registrations/[ref]/pay");

  const pay = page.getByRole("button", { name: `Pay ${TOTAL}` });
  await pay.click();
  const checkout = page.getByRole("region", { name: "Test checkout" });
  await expect(checkout).toBeVisible();
  await expect(
    checkout.getByRole("heading", { name: "Test checkout" })
  ).toBeFocused();
  await expect(checkout).toContainText(
    `Fees for 2 students in ${OPEN} (${reference})`
  );
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/pay with the test checkout"
  );

  await checkout.getByRole("button", { name: "Decline (test)" }).click();
  // In <main>: Next's route announcer is an alert too.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "The payment didn't go through, so nothing was charged."
  );
  await expect(checkout).toBeHidden();

  // Paying again reuses the same order, once the gateway says it is unpaid.
  await pay.click();
  await page
    .getByRole("region", { name: "Test checkout" })
    .getByRole("button", { name: "Pay (test)" })
    .click();

  await expect(page).toHaveURL(
    new RegExp(
      `/institution/registrations/${reference}/payments/[0-9a-f-]{36}\\?institution=`
    )
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Payment" })
  ).toBeVisible();
  const details = page.getByRole("region", { name: "Payment details" });
  await expect(details.getByText("Paid", { exact: true })).toBeVisible();
  await expect(details).toContainText(`Amount${TOTAL}`);
  const students = page.getByRole("table", {
    name: "Students in this payment",
  });
  for (const name of ["Kabir Shah", "Tara Menon"]) {
    const row = students.getByRole("row", { name: new RegExp(name) });
    await expect(row.getByText("Confirmed")).toBeVisible();
    await expect(row.getByRole("cell").last()).toHaveText(
      /^NEIGH27-R-[0-9A-HJKMNP-TV-Z]{6}$/
    );
  }
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/payments/[batchId] paid"
  );

  // Nothing is left to pay, and the pay page points to the receipt.
  await page.goto(payPath);
  await expect(page.getByText("No fees are waiting")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "See your last payment" })
  ).toBeVisible();
  await checkBothThemes(page, "/institution/registrations/[ref]/pay paid");
});

test("the pay page sends a visitor to sign in", async ({ page }) => {
  await page.goto("/institution/registrations/NEIGH27-I-5EED1/pay");

  await expect(page).toHaveURL(/\/sign-in$/);
});
