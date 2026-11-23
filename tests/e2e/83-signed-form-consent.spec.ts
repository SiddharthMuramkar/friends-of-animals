import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_REGISTRATIONS } from "../../src/server/seed/registration";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test, type SeedAccount } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

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

async function openSignedForm(page: Page, student: string) {
  await page
    .getByRole("link", { name: `Review form for ${student}`, exact: true })
    .click();
  const record = page.getByRole("article", { name: student, exact: true });
  await expect(
    record.getByRole("heading", { name: student, exact: true })
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
  await signInAsReviewer(page, request, seedAccount);
  await expectRendersAccessibly(page, QUEUE);
  await expectAccessibleInDark(page, "signed forms queue");
  const record = await openSignedForm(page, "Diya N.");
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
  await signInAsReviewer(page, request, seedAccount);
  await page.getByRole("link", { name: "Accepted", exact: true }).click();
  const accepted = await openSignedForm(page, "Aarav K.");
  await expectRendersAccessibly(page, new URL(page.url()).pathname);
  await expect(accepted.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(
    accepted.getByText(/Reviewed by Seed Super Admin/)
  ).toBeVisible();
  await expectAccessibleInDark(page, "accepted signed form");

  await page.goto(`${QUEUE}?status=rejected`);
  const rejected = await openSignedForm(page, "Kabir J.");
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
  const student = row("Meher Iyer");
  await student.getByText("Upload a signed form", { exact: true }).click();
  await expect(student.getByLabel("Choose a scan")).toBeVisible();
  await expect(
    student.getByRole("checkbox", { name: /Public gallery and results/ })
  ).toBeVisible();
  await expectAccessible(page, "coordinator signed-form upload");
  await expectAccessibleInDark(page, "coordinator signed-form upload");
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
