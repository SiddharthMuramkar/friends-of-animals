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

test("staff can read the signed-form queue and see an accessible rejection error", async ({
  page,
  request,
  seedAccount,
}) => {
  await signInAsReviewer(page, request, seedAccount);
  await expectRendersAccessibly(page, QUEUE);
  await expectAccessibleInDark(page, "signed forms queue");
  await page.getByRole("link", { name: "Review form for Diya N." }).click();
  await expect(page.getByRole("heading", { name: "Diya N." })).toBeVisible();
  await expect(page.getByText("Pending review", { exact: true })).toBeVisible();
  await expectAccessible(page, "pending signed form");
  await page.getByLabel("Rejection reason").selectOption("other");
  await page.getByRole("button", { name: "Reject signed form" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Add a note explaining why you chose Other."
  );
  await expect(page.getByLabel("Note to the coordinator")).toHaveAttribute(
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
  await page.getByRole("link", { name: "Review form for Aarav K." }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(page.getByText(/Reviewed by Seed Super Admin/)).toBeVisible();
  await expectAccessible(page, "accepted signed form");
  await expectAccessibleInDark(page, "accepted signed form");

  await page.goto(`${QUEUE}?status=rejected`);
  await page.getByRole("link", { name: "Review form for Kabir J." }).click();
  await expect(
    page.getByText("The form is missing a signature.")
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
