import {
  expect,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { freshEmail } from "./support/mailbox";
import type { SeedAccount } from "./support/seed-account";
import { test } from "./support/seed-listing";
import { signInByCode } from "./support/sign-in";

// #127: a member registers their organisation on FOA's NGO directory and
// sees it waiting, private; FOA's staff admin finds it in the queue and
// verifies it with a reason, which puts it on its public page; the
// listing's representative uploads proof (which only staff can open),
// edits it and withdraws it. Every new page is checked with axe, light and
// dark, and no page breaks the Content Security Policy.
//
// Each test seeds its own pending listing and staff admin
// (./support/seed-listing.ts), so they run in parallel, on both projects,
// against one database, each within the 30 s budget.

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

/**
 * Signs in a fresh FOA admin with an authenticator of their own, opens
 * `path` and passes the second factor it asks for. Desktop signs in a
 * super admin and mobile a staff admin: both may review and decide.
 */
async function signInAsFoaAdmin(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  testInfo: TestInfo,
  path: string
) {
  const secret = generateTotpSecret();
  const role =
    testInfo.project.name === "mobile" ? "staff_admin" : "super_admin";
  const email = await seedAccount({
    name: "Seed FOA Admin",
    grants: [{ role, scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(path)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(path);
}

const PDF = Buffer.from("%PDF-1.7\n% a registration certificate\n%%EOF\n");

test("a member fixes a refused PIN code, registers a listing and sees it waiting, private", async ({
  page,
  request,
}, testInfo) => {
  const name = `E2E Rescue ${Date.now().toString(36)}`;
  const violations = await recordCspViolations(page);
  await signInByCode(
    page,
    request,
    freshEmail(testInfo.project.name),
    "Asha Rao"
  );

  await page.goto("/ngos/register");
  await checkBothThemes(page, "/ngos/register");
  const field = (label: string) => page.getByLabel(label, { exact: true });
  await field("You are").selectOption("independent_rescuer");
  await field("Name").fill(name);
  await field("What you do").fill("I rescue injured dogs around Kothrud.");
  await page.getByRole("checkbox", { name: "Rescue", exact: true }).check();
  await field("Address").fill("4 Seed Lane, Kothrud");
  await field("Town or city").fill("Pune");
  await field("State").fill("Maharashtra");
  await field("PIN code").fill("011001");
  await field("Mobile number").fill("90000 12791");
  await page.getByRole("checkbox", { name: "Show my mobile number" }).check();
  await page.getByRole("button", { name: "Send for checking" }).click();
  // In <main>: Next's route announcer is an alert too.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Some answers need fixing"
  );
  await expect(field("PIN code")).toHaveAttribute("aria-invalid", "true");
  await checkBothThemes(page, "/ngos/register with an error");
  await field("PIN code").fill("411038");
  await page.getByRole("button", { name: "Send for checking" }).click();

  await expect(page).toHaveURL(/\/organisation\/[0-9a-f-]{36}\?registered=1$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(
    page.getByText("Waiting for FOA", { exact: true })
  ).toBeVisible();
  await checkBothThemes(page, "/organisation/[id] pending");

  await page.goto("/organisation");
  await expect(page.getByRole("link", { name })).toBeVisible();
  await checkBothThemes(page, "/organisation");
  expect(violations).toEqual([]);
});

test("FOA's staff admin needs a reason to verify a listing, which then shows on its public page", async ({
  page,
  request,
  seedAccount,
  seedPendingListing,
}, testInfo) => {
  const listing = await seedPendingListing({ ownerName: "Farah Khan" });
  // Pending: the public page is the 404.
  expect((await page.goto(`/ngos/${listing.slug}`))?.status()).toBe(404);

  const violations = await recordCspViolations(page);
  await signInAsFoaAdmin(
    page,
    request,
    seedAccount,
    testInfo,
    "/admin/directory"
  );
  const reviewLink = page.getByRole("link", {
    name: listing.name,
    exact: true,
  });
  await expect(reviewLink).toBeVisible();
  await checkBothThemes(page, "/admin/directory");
  await reviewLink.click();
  await expect(page).toHaveURL(`/admin/directory/${listing.id}`);
  await expect(page.getByText("12 Lane 4, Koregaon Park")).toBeVisible();
  await checkBothThemes(page, "/admin/directory/[id]");

  await page.getByRole("button", { name: "Verify" }).click();
  await expect(
    page.getByText("Write a reason for this decision.")
  ).toBeVisible();
  await page.getByLabel("Reason").fill("Checked the trust deed by phone");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("Verified.");
  await checkBothThemes(page, "/admin/directory/[id] verified");

  await page.getByRole("link", { name: "See the public page" }).click();
  await expect(page).toHaveURL(`/ngos/${listing.slug}`);
  await expect(
    page.getByRole("heading", { name: listing.name, level: 1 })
  ).toBeVisible();
  await expect(page.getByText("Checked by FOA")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "e2e-paws@example.test" })
  ).toBeVisible();
  // The address and the unchosen phone never show.
  await expect(page.getByText("Koregaon Park")).toHaveCount(0);
  await expect(page.getByText("90000 12790")).toHaveCount(0);
  await checkBothThemes(page, "/ngos/[slug]");
  expect(violations).toEqual([]);
});

test("the registrant uploads proof, edits the listing and withdraws it", async ({
  page,
  request,
  seedPendingListing,
}) => {
  const listing = await seedPendingListing({ ownerName: "Farah Khan" });
  const violations = await recordCspViolations(page);
  await signInByCode(page, request, listing.ownerEmail);

  await page.goto(`/organisation/${listing.id}`);
  await expect(page.getByText("Nothing sent yet.")).toBeVisible();
  await page.getByLabel("What it is").selectOption("registration_certificate");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "certificate.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("status")).toContainText("Uploaded.");
  const sent = page.getByRole("table", { name: "Files sent to FOA" });
  await expect(
    sent.getByRole("rowheader", { name: "Registration certificate" })
  ).toBeVisible();
  await checkBothThemes(page, "/organisation/[id] with a document");

  await page.getByRole("link", { name: "Change the details" }).click();
  await expect(page).toHaveURL(`/organisation/${listing.id}/edit`);
  await checkBothThemes(page, "/organisation/[id]/edit");
  await page
    .getByLabel("What you do", { exact: true })
    .fill("Rescue and treatment for street animals, day and night.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(
    `/organisation/${listing.id}?saved=savedPending`
  );
  await expect(page.getByText("day and night.")).toBeVisible();

  await page.getByLabel("Why (optional)").fill("We merged with another trust.");
  await page.getByRole("button", { name: "Withdraw the listing" }).click();
  await expect(page).toHaveURL(`/organisation/${listing.id}?saved=withdrawn`);
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Change the details" })
  ).toHaveCount(0);
  expect(violations).toEqual([]);
});

test("an unknown listing address is the 404", async ({ page }) => {
  const response = await page.goto("/ngos/no-such-listing-here");
  expect(response?.status()).toBe(404);
});
