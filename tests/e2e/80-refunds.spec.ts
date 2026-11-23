import { expect, test, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { grantGlobalRole } from "./support/roles";
import { signInByCode } from "./support/sign-in";

// #80: the refunds pages. A fresh member is refused, then, granted the
// finance and staff admin roles, adds an authenticator at #60's staff gate
// (a seeded authenticator would clash with other runs: a code works once).
// They read the refunds queue (the seeded refund waiting for finance, and
// the seeded refunded one), each refund's page, and the request page of
// the seeded paid batch. Both forms are sent with a mistake, so each shows
// its error and writes nothing: no step changes a seeded row, so runs
// can't disturb each other. Approving, rejecting, the gateway's answers,
// webhooks, retries, manual refunds and who may do what are proved at
// Seam 1 (src/server/modules/payments/refunds/*.test.ts).

/** SEED_REFUNDS and SEED_PAYMENTS (src/server/seed/refunds.ts, payments.ts). */
const SEEDED = {
  paidBatch: "01938a00-0000-7000-8000-000000007201",
  waitingRefund: "01938a00-0000-7000-8000-000000008301",
  refundedRefund: "01938a00-0000-7000-8000-000000008302",
};

const DENIED = "Only FOA's finance and staff teams can open this";

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

test("finance reads the refunds queue and a refund, a staff admin opens the request page, and each form says what is wrong", async ({
  page,
  request,
}, testInfo) => {
  // A long staff journey: 20 to 27 s on CI, and 33 s as a shard's first
  // test on a cold server, past the 30 s default.
  test.setTimeout(60_000);
  const email = freshEmail(testInfo.project.name);
  await signInByCode(page, request, email, "Farah Refunds");

  // A member without a role is told the pages aren't theirs.
  await visit(page, "/admin/refunds");
  await expect(page.getByRole("heading", { name: DENIED })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expectAccessible(page, "/admin/refunds, refused");
  await visit(page, `/admin/refunds/${SEEDED.waitingRefund}`);
  await expect(
    page.getByRole("heading", { level: 1, name: DENIED })
  ).toBeVisible();

  // Granted finance and staff admin, they add an authenticator first.
  await grantGlobalRole(email, "finance");
  await grantGlobalRole(email, "staff_admin");
  await visit(page, "/admin/refunds");
  await expect(page).toHaveURL(/\/account\/security\?next=%2Fadmin%2Frefunds$/);
  await page.getByRole("textbox", { name: "Name it" }).first().fill("Phone");
  await page.getByRole("button", { name: "Set up an app" }).click();
  const key = await page
    .getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    .textContent();
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(key ?? ""), new Date()));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/admin\/refunds$/);

  // The queue: the seeded refund waiting for finance.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Refunds");
  await expect(page).toHaveTitle(/^Refunds ·/);
  const waiting = page.getByRole("link", {
    name: "Open refund of ₹1,000.00 to Seed Public School",
  });
  await expect(waiting).toBeVisible();
  await expect(page.getByRole("row").filter({ has: waiting })).toContainText(
    "Waiting for finance"
  );
  await checkBothThemes(page, "/admin/refunds");
  await page.getByRole("link", { name: "Done", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/refunds\?view=done$/);
  await expect(
    page.getByRole("row").filter({ hasText: "Refunded" })
  ).toHaveCount(1);
  await checkBothThemes(page, "/admin/refunds?view=done");
  await page.getByRole("link", { name: "In progress", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/refunds\?view=in_progress$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await checkBothThemes(page, "/admin/refunds?view=in_progress");

  // The waiting refund's page, and a rejection sent without a note.
  await visit(page, `/admin/refunds/${SEEDED.waitingRefund}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Refund of ₹1,000.00" })
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Refund ·/);
  const details = page.getByRole("region", { name: "Details", exact: true });
  await expect(details).toContainText("Waiting for finance");
  await expect(details).toContainText("Kinder Skies");
  await expect(
    page.getByRole("table", { name: "Students this refund returns" })
  ).toContainText("SKIES26-R-5EED01");
  await expect(page.getByText("The refund policy")).toBeVisible();
  await checkBothThemes(page, "/admin/refunds/[id] waiting");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(
    page.getByText("Write a note saying why it is rejected.")
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await checkBothThemes(page, "/admin/refunds/[id], no note");
  // Nothing was decided: it still waits for finance.
  await visit(page, `/admin/refunds/${SEEDED.waitingRefund}`);
  await expect(
    page.getByRole("region", { name: "Details", exact: true })
  ).toContainText("Waiting for finance");

  // The refunded one: no decision left to take.
  await visit(page, `/admin/refunds/${SEEDED.refundedRefund}`);
  await expect(
    page.getByRole("region", { name: "Details", exact: true })
  ).toContainText("rfnd_seed_refunded");
  await expect(
    page.getByRole("button", { name: "Approve refund" })
  ).toHaveCount(0);
  await checkBothThemes(page, "/admin/refunds/[id] refunded");

  // The paid batch's request page, sent without a reason.
  await visit(page, `/admin/payments/batches/${SEEDED.paidBatch}`);
  await page.getByRole("link", { name: "Refunds of this payment" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/payments/batches/${SEEDED.paidBatch}/refund$`)
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Ask for a refund" })
  ).toBeVisible();
  const students = page.getByRole("group", { name: "Students to refund" });
  await expect(students.getByRole("checkbox")).toHaveCount(2);
  await expect(
    page.getByText("SKIES26-R-5EED01: in a refund already")
  ).toBeVisible();
  await checkBothThemes(page, "/admin/payments/batches/[id]/refund");
  await page.getByRole("button", { name: "Ask finance to refund" }).click();
  await expect(page.getByText("Write a reason for the refund.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reason" })).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await checkBothThemes(page, "/admin/payments/batches/[id]/refund, no reason");
  // Nothing was asked: the batch has its one refund still.
  await visit(page, `/admin/payments/batches/${SEEDED.paidBatch}/refund`);
  await expect(
    page
      .getByRole("region", { name: "Refunds of this payment" })
      .getByRole("link")
  ).toHaveCount(1);
});
