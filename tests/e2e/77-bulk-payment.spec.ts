import { expect, type BrowserContext, type Page } from "@playwright/test";

import { CLEAN_STUDENT_IMPORT_CSV_30 } from "../../src/server/seed/student-import-samples";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { payInOpenCheckout } from "./support/checkout";
import {
  sendInstitutionForChecking,
  verifyAsStaffAdmin,
} from "./support/institution-journey";
import { freshEmail } from "./support/mailbox";
import {
  REGISTRATION_NUMBER,
  registrationNumbersIn,
} from "./support/payment-values";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #77's Seam 2 journey (M1, 77c): a school pays for its whole class at
// once. Its authorised person signs up by email code and sends the
// institution for checking; a seeded FOA staff admin verifies it with
// their authenticator; the authorised person registers it for the seeded
// open competition, imports #76's clean 30-row file, and pays the 30 fees
// in one payment; the payment's page and the students page then show all
// 30 confirmed, each with its own registration number. The students page's
// fees summary is checked with axe, light and dark, before and after
// paying (the pay and payment pages' states are #77's 77-pay-page.spec.ts).
//
// The app chooses the gateway, and the payment's page says which one made
// the order: CI runs with no Razorpay keys, so the fallback's test checkout
// pays; Razorpay in test mode pays where its keys are set (HR-09). The
// messages the payment sends are Seam 1's (payment-messages.test.ts), so
// nothing here waits for a worker.
//
// One journey in four tests, one after another in one browser for the
// authorised person, so each step fits the 30 s test budget on the mobile
// project in CI (#55); a later test needs the earlier ones.

/** The seeded open competition (src/server/seed/competitions.ts). */
const OPEN = "Neighbours on My Street";

// Its sample institution fee is ₹1,000 a student
// (src/server/seed/competition-terms.ts): 30 students owe ₹30,000.
const FEE = "₹1,000";
const TOTAL = "₹30,000";

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

test.describe("a school pays for 30 students in one payment", () => {
  test.describe.configure({ mode: "serial" });

  let context: BrowserContext;
  /** The authorised person's browser, signed in from the first test on. */
  let school: Page;
  let schoolName: string;

  // A context of its own, with this project's device: axe opens another
  // page beside the one under test.
  test.beforeAll(async ({ browser }, testInfo) => {
    const {
      baseURL,
      deviceScaleFactor,
      hasTouch,
      isMobile,
      storageState,
      userAgent,
      viewport,
    } = testInfo.project.use;
    context = await browser.newContext({
      baseURL,
      deviceScaleFactor,
      hasTouch,
      isMobile,
      reducedMotion: "reduce",
      storageState,
      userAgent,
      viewport,
    });
    school = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("the authorised person signs up by email code and sends the institution for checking", async ({
    request,
  }, testInfo) => {
    const project = testInfo.project.name;
    schoolName = `E2E Bulk Pay School ${project} ${Date.now().toString(36)}`;
    await signInByCode(school, request, freshEmail(project), "Rekha Pillai");

    await sendInstitutionForChecking(school, schoolName);
  });

  test("an FOA staff admin verifies it with their authenticator", async ({
    page,
    request,
    seedAccount,
  }) => {
    const code = await verifyAsStaffAdmin(
      page,
      request,
      seedAccount,
      schoolName
    );

    // The authorised person sees it verified, in the session they had.
    await school.goto("/institution");
    await expect(school.getByText("Verified", { exact: true })).toBeVisible();
    await expect(school.getByText(/^FOA-I-[0-9A-Z]{5}$/)).toHaveText(code);
  });

  test("the authorised person registers for the open competition and imports 30 students", async () => {
    await school.goto("/institution/competitions");
    const open = school.getByRole("article", { name: OPEN });
    await open
      .getByRole("button", { name: `Register ${schoolName} for ${OPEN}` })
      .click();
    await open
      .getByRole("link", { name: `Students of ${schoolName} in ${OPEN}` })
      .click();
    await expect(school.getByText("No students enrolled")).toBeVisible();
    // Nothing to pay for yet, so no fees summary.
    await expect(
      school.getByRole("region", { name: "Fees", exact: true })
    ).toHaveCount(0);

    await school
      .getByRole("link", { name: "Import students from a spreadsheet" })
      .click();
    await school.getByLabel("CSV file").setInputFiles({
      name: "class-3.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CLEAN_STUDENT_IMPORT_CSV_30, "utf8"),
    });
    await school.getByRole("button", { name: "Import students" }).click();
    // In <main>: Next's route announcer is an alert too.
    const main = school.getByRole("main");
    await expect(
      main.getByRole("alert").or(main.getByRole("status"))
    ).toContainText("All 30 students are enrolled.");

    await school.getByRole("link", { name: "Back to students" }).click();
    await expect(school.getByText("30 students enrolled")).toBeVisible();
    const fees = school.getByRole("region", { name: "Fees", exact: true });
    await expect(fees).toContainText("Waiting for their fee30");
    await expect(fees).toContainText("Confirmed0");
    await expect(
      fees.getByRole("link", { name: "Pay fees for 30 students" })
    ).toBeVisible();
    await checkBothThemes(
      school,
      "/institution/registrations/[ref] with fees waiting"
    );
  });

  test("the authorised person pays the 30 fees in one payment and sees every student confirmed with a registration number", async () => {
    await school
      .getByRole("region", { name: "Fees", exact: true })
      .getByRole("link", { name: "Pay fees for 30 students" })
      .click();
    await expect(
      school.getByRole("heading", { level: 1, name: "Pay fees" })
    ).toBeVisible();
    // 30 × ₹1,000 = ₹30,000, in one payment.
    const summary = school.getByRole("region", { name: "What you pay" });
    await expect(summary).toContainText("Students waiting for their fee30");
    await expect(summary).toContainText(`Fee per student${FEE}`);
    await expect(summary).toContainText(`Total${TOTAL}`);

    await school.getByRole("button", { name: `Pay ${TOTAL}` }).click();
    const gateway = await payInOpenCheckout(school);
    // Which gateway ran, for the PR and the report.
    test.info().annotations.push({ type: "gateway", description: gateway });

    await expect(school).toHaveURL(/\/payments\/[0-9a-f-]{36}\?institution=/);
    const details = school.getByRole("region", { name: "Payment details" });
    await expect(details.getByText("Paid", { exact: true })).toBeVisible();
    await expect(details).toContainText(`Amount${TOTAL}`);
    await expect(details).toContainText("Students30");
    await expect(details.locator("[data-gateway]")).toHaveAttribute(
      "data-gateway",
      gateway
    );
    const paid = school.getByRole("table", {
      name: "Students in this payment",
    });
    await expect(paid.getByText("Confirmed", { exact: true })).toHaveCount(30);
    const numbers = registrationNumbersIn(await paid.innerText());
    expect(numbers).toHaveLength(30);
    expect(new Set(numbers).size).toBe(30);
    for (const number of numbers) expect(number).toMatch(REGISTRATION_NUMBER);

    // The students page: every fee paid, nothing left to pay, and each
    // student confirmed with the same number.
    await school.getByRole("link", { name: "Back to your students" }).click();
    const fees = school.getByRole("region", { name: "Fees", exact: true });
    await expect(fees).toContainText("Every enrolled student's fee is paid.");
    await expect(fees).toContainText("Confirmed30");
    await expect(school.getByRole("link", { name: /^Pay fees/ })).toHaveCount(
      0
    );
    const students = school.getByRole("region", { name: "Enrolled students" });
    await expect(students.getByText("Confirmed", { exact: true })).toHaveCount(
      30
    );
    expect(
      registrationNumbersIn(await students.innerText()).toSorted()
    ).toEqual(numbers.toSorted());
    await checkBothThemes(school, "/institution/registrations/[ref] all paid");
  });
});
