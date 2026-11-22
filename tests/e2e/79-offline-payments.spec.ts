import { expect, test, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { grantGlobalRole } from "./support/roles";
import { signInByCode } from "./support/sign-in";

// #79: the finance team's payments pages. A fresh member is refused, then,
// granted the finance role, adds an authenticator at #60's staff gate (a
// seeded authenticator would clash with other runs: a code works once).
// They read the seeded payment in review (money for Kinder Skies that
// arrived after registration closed), its batch, the seeded batch paid by
// cheque, and the seeded unpaid batch's form to record an offline payment.
// Both forms are sent with a mistake, so each shows its error and writes
// nothing: no step changes a seeded row, so runs can't disturb each other.
// Recording, the review of late captures, resolving and who may do what
// are proved at Seam 1 (src/server/modules/payments/*.test.ts).

/** SEED_PAYMENTS (src/server/seed/payments.ts). */
const SEEDED = {
  unpaidBatch: "01938a00-0000-7000-8000-000000007202",
  chequeBatch: "01938a00-0000-7000-8000-000000007203",
  reviewBatch: "01938a00-0000-7000-8000-000000007204",
};

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

test("finance reads a payment in review and the batches, and each form says what is wrong", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await signInByCode(page, request, email, "Nisha Finance");

  // A member without the role is told the pages aren't theirs.
  await visit(page, "/admin/payments/review");
  await expect(
    page.getByRole("heading", {
      name: "Only FOA's finance team can open this",
    })
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expectAccessible(page, "/admin/payments/review, refused");
  await visit(page, `/admin/payments/batches/${SEEDED.chequeBatch}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Only FOA's finance team can open this",
    })
  ).toBeVisible();
  await expect(page.getByText("004512")).toHaveCount(0);

  // Granted the role, they add an authenticator at the staff gate first.
  await grantGlobalRole(email, "finance");
  await visit(page, "/admin/payments/review");
  await expect(page).toHaveURL(
    /\/account\/security\?next=%2Fadmin%2Fpayments%2Freview$/
  );
  await page.getByRole("textbox", { name: "Name it" }).first().fill("Phone");
  await page.getByRole("button", { name: "Set up an app" }).click();
  const key = await page
    .getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    .textContent();
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(key ?? ""), new Date()));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/admin\/payments\/review$/);

  // The open payments: the seeded one, which arrived after the close.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Payments needing review"
  );
  await expect(page).toHaveTitle(/^Payments needing review ·/);
  const seeded = page.getByRole("link", {
    name: "Review payment of ₹1,000.00 from Seed Public School",
  });
  await expect(seeded).toBeVisible();
  await expect(page.getByRole("row").filter({ has: seeded })).toContainText(
    "After registration closed"
  );
  await checkBothThemes(page, "/admin/payments/review");
  await page.getByRole("link", { name: "Resolved" }).click();
  await expect(page).toHaveURL(/\/admin\/payments\/review\?view=resolved$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await checkBothThemes(page, "/admin/payments/review?view=resolved");

  // The payment's own page, and its decision sent without a reason.
  await page.getByRole("link", { name: "Open" }).click();
  await seeded.click();
  await expect(page).toHaveURL(/\/admin\/payments\/review\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Payment of ₹1,000.00" })
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Payment needing review ·/);
  await expect(page.getByText("Kinder Skies")).toBeVisible();
  await checkBothThemes(page, "/admin/payments/review/[id]");
  await page.getByRole("button", { name: "Accept the money" }).click();
  await expect(
    page.getByText("Write a reason of at least 10 characters.")
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reason" })).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await checkBothThemes(page, "/admin/payments/review/[id], no reason");

  // Its batch: in review, with the case listed.
  await page.getByRole("link", { name: "See the whole payment" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/payments/batches/${SEEDED.reviewBatch}$`)
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Payment of ₹1,000.00" })
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Details" }).getByText("Needs review")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "After registration closed, Open" })
  ).toBeVisible();
  await checkBothThemes(page, "/admin/payments/batches/[id] in review");

  // The batch paid by cheque, with its offline payment.
  await visit(page, `/admin/payments/batches/${SEEDED.chequeBatch}`);
  const offline = page.getByRole("region", { name: "Offline payment" });
  await expect(offline).toContainText("Cheque");
  await expect(offline).toContainText("004512");
  await expect(
    offline.getByRole("button", { name: "Open the proof" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Record an offline payment" })
  ).toHaveCount(0);
  await checkBothThemes(page, "/admin/payments/batches/[id] paid by cheque");

  // The unpaid batch's form, sent without a reference or a proof.
  await visit(page, `/admin/payments/batches/${SEEDED.unpaidBatch}`);
  const record = page.getByRole("region", {
    name: "Record an offline payment",
  });
  await expect(record).toBeVisible();
  await expect(record.getByRole("radio", { name: "Cheque" })).toBeChecked();
  await checkBothThemes(page, "/admin/payments/batches/[id] unpaid");
  await record.getByRole("button", { name: "Record payment" }).click();
  await expect(
    record.getByText("Enter the reference as it's written", { exact: false })
  ).toBeVisible();
  await expect(
    record.getByRole("textbox", { name: "Reference" })
  ).toHaveAttribute("aria-invalid", "true");
  await checkBothThemes(page, "/admin/payments/batches/[id], form errors");
  // Nothing was recorded: the batch still waits for its payment.
  await visit(page, `/admin/payments/batches/${SEEDED.unpaidBatch}`);
  await expect(
    page
      .getByRole("region", { name: "Details" })
      .getByText("Waiting for payment", { exact: true })
  ).toBeVisible();
});
