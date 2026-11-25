import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { readMediaFixture } from "../../src/test/media-fixtures";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import {
  SEED_REGISTRATIONS,
  SEED_STUDENTS,
} from "../../src/server/seed/registration";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import type { SeedAccount } from "./support/seed-account";
import { STUDENT, test } from "./support/seed-consent-student";
import { signInByCode } from "./support/sign-in";
import { countViewTransitions } from "./support/view-transitions";

const QUEUE = "/admin/consent-forms";
const PENDING_FORM = `${QUEUE}/01938a00-0000-7000-8083-000000000002`;
const school = SEED_REGISTRATIONS.institution;
const DASHBOARD = `/institution/registrations/${school.reference}?institution=${school.institutionId}`;

async function signInAsReviewer(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Synthetic Form Reviewer",
    grants: [{ role: "staff_admin", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(QUEUE);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(QUEUE)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(QUEUE);
}

async function openSignedForm(page: Page, shortName: string, fullName: string) {
  await page
    .getByRole("link", { name: `Review form for ${shortName}`, exact: true })
    .click();
  const record = page.getByRole("article", { name: fullName, exact: true });
  await expect(
    record.getByRole("heading", { name: fullName, exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Filter by review status" })
  ).toBeHidden();
  return record;
}

test("staff can read the signed-form queue and see an accessible rejection error", async ({
  page,
  request,
  seedAccount,
}) => {
  const transitions = await countViewTransitions(page);
  await signInAsReviewer(page, request, seedAccount);
  await expectRendersAccessibly(page, QUEUE);
  await expectAccessibleInDark(page, "signed forms queue");
  const beforeReview = await transitions();
  const record = await openSignedForm(page, "Diya N.", "Diya Nair");
  await expect(
    record.getByText(`Enrolment reference ${SEED_STUDENTS[1]!.registrationId}`)
  ).toBeVisible();
  await expect
    .poll(transitions, { message: "view transition when opening the review" })
    .toBeGreaterThan(beforeReview);
  await expect(
    record.getByText("Pending review", { exact: true })
  ).toBeVisible();
  await expectAccessible(page, "pending signed form");
  const rejection = record.getByRole("form", { name: "Reject signed form" });
  await rejection.getByLabel("Rejection reason").selectOption("other");
  await rejection.getByRole("button", { name: "Reject signed form" }).click();
  await expect(rejection.getByRole("alert")).toContainText(
    "Add a note explaining why you chose Other."
  );
  await expect(rejection.getByLabel("Note to the coordinator")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await expectAccessibleInDark(page, "rejection validation");
});

test("staff can read accepted, rejected and empty review states", async ({
  page,
  request,
  seedAccount,
}) => {
  const transitions = await countViewTransitions(page);
  await signInAsReviewer(page, request, seedAccount);
  const acceptedFilter = page.getByRole("link", {
    name: "Accepted",
    exact: true,
  });
  const beforeFilter = await transitions();
  await acceptedFilter.click();
  await expect(acceptedFilter).toHaveAttribute("aria-current", "page");
  await expect
    .poll(transitions, { message: "view transition when filtering the queue" })
    .toBeGreaterThan(beforeFilter);
  const accepted = await openSignedForm(page, "Aarav K.", "Aarav Kulkarni");
  await expectRendersAccessibly(page, new URL(page.url()).pathname);
  await expect(accepted.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(
    accepted.getByText(/Reviewed by Seed Super Admin/)
  ).toBeVisible();
  await expectAccessibleInDark(page, "accepted signed form");

  await page.goto(`${QUEUE}?status=rejected`);
  const rejected = await openSignedForm(page, "Kabir J.", "Kabir Joshi");
  await expect(
    rejected.getByText("The form is missing a signature.")
  ).toBeVisible();
  await expectAccessible(page, "rejected signed form");
  await expectAccessibleInDark(page, "rejected signed form");

  await expectRendersAccessibly(page, `${QUEUE}?status=withdrawn`);
  await expect(
    page.getByText("There are no forms with this status.")
  ).toBeVisible();
  await expectAccessibleInDark(page, "empty review queue");
});

test("a coordinator can find signed-form status and open the upload control", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({
    name: "Synthetic School Coordinator",
    grants: [
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: school.institutionId },
      },
    ],
  });
  await signInByCode(page, request, email);
  await expectRendersAccessibly(page, DASHBOARD);
  const row = (name: string) =>
    page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(row("Diya Nair").getByText("Pending review")).toBeVisible();
  await expect(
    row("Kabir Joshi").getByText("The form is missing a signature.")
  ).toBeVisible();
  const granted = row("Aarav Kulkarni");
  await expect(granted.getByText("Current public-use consent")).toBeVisible();
  await expect(granted.getByText("Granted", { exact: true })).toBeVisible();
  await expect(
    row("Diya Nair").getByText("No current consent").first()
  ).toBeVisible();
  const student = row("Meher Iyer");
  await student.getByText("Upload a signed form", { exact: true }).click();
  await expect(student.getByLabel("Choose a scan")).toBeVisible();
  await expect(
    student.getByRole("checkbox", { name: /Public gallery and results/ })
  ).toBeVisible();
  await expectAccessible(page, "coordinator signed-form upload");
  await expectAccessibleInDark(page, "coordinator signed-form upload");
});

test("a coordinator submits a private signed form for review", async ({
  page,
  request,
  consentStudent,
}) => {
  await signInByCode(page, request, consentStudent.adminEmail);
  await expectRendersAccessibly(
    page,
    `/institution/registrations/${consentStudent.reference}?institution=${consentStudent.institutionId}`
  );
  const student = page.locator("li").filter({
    has: page.getByRole("heading", { name: STUDENT, exact: true }),
  });
  await student.getByText("Upload a signed form", { exact: true }).click();
  await student.getByLabel("Choose a scan").setInputFiles({
    name: "signed-form.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(readMediaFixture("gpsJpeg")),
  });
  await student
    .getByRole("checkbox", { name: /Public gallery and results/ })
    .check();
  await student.getByRole("button", { name: "Submit for review" }).click();
  await expect(
    student.getByText("Pending review", { exact: true })
  ).toBeVisible();
});

test("a signed-in member sees accessible review access denials", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "Synthetic Member", grants: [] });
  await signInByCode(page, request, email);

  for (const path of [QUEUE, PENDING_FORM]) {
    await expectRendersAccessibly(page, path);
    await expect(
      page.getByRole("heading", { name: "Review access required", level: 2 })
    ).toBeVisible();
    await expect(
      page.getByText("Your account cannot review signed consent forms.")
    ).toBeVisible();
  }
});
