import { randomInt, randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../src/server/db/schema";
import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { systemClock } from "../../src/server/ports/clock";
import { competitionBuilder } from "../../src/server/seed/competitions";
import { SEED_PAYMENTS } from "../../src/server/seed/payments";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { grantGlobalRole } from "./support/roles";
import {
  localSeedUrl,
  test as base,
  type SeedAccount,
} from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #80 (80b): the cancel page. A fresh member is refused, then, granted the
// super admin role, adds an authenticator at #60's staff gate (a seeded
// authenticator would clash with other runs: a code works once). They open
// the seeded open competition's cancel page, read what cancelling would
// do, and send the form without a reason: it says what is wrong and
// cancels nothing, so no step changes a seeded row and runs can't disturb
// each other. The seeded cancelled competition's page says when and why,
// and its public page says it was cancelled. Cancelling itself, its
// refunds, messages and who may do it are proved at Seam 1
// (src/server/modules/competitions/cancel-competition.test.ts).

/** The competitions seed's open competition, and the cancelled one
 * (src/server/seed/competitions.ts, competition-cancelled.ts). */
const SEEDED = {
  open: {
    id: "01938a00-0000-7000-8000-000000002101",
    name: "Neighbours on My Street",
  },
  cancelled: {
    id: "01938a00-0000-7000-8000-000000002104",
    slug: "wings-at-dusk",
    name: "Wings at Dusk",
  },
};

const DENIED = "Only a super admin can cancel a competition";
const CANCEL_TITLE = "Cancel a competition · Friends of Animals";

type SeedCompetition = (status: "draft" | "registration_open") => Promise<{
  id: string;
  slug: string;
  name: string;
}>;

const test = base.extend<{ seedCompetition: SeedCompetition }>({
  seedCompetition: async ({ baseURL }, use) => {
    const client = postgres(localSeedUrl(baseURL), { max: 1, prepare: false });
    const db = drizzle(client, { schema });
    const seed = competitionBuilder({ db, clock: systemClock });
    const ids: string[] = [];
    try {
      await use(async (status) => {
        const letters = Array.from({ length: 6 }, () =>
          String.fromCharCode(65 + randomInt(26))
        ).join("");
        const name = `E2E cancellation ${letters}`;
        const result = await seed({ status, name, code: `${letters}27` });
        ids.push(result.id);
        return { ...result, name };
      });
    } finally {
      try {
        await db
          .delete(schema.outbox)
          .where(inArray(schema.outbox.aggregateId, ids));
        await db
          .delete(schema.competition)
          .where(inArray(schema.competition.id, ids));
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});

async function checkBothThemes(
  page: Page,
  label: string,
  title = CANCEL_TITLE
) {
  await expect(page).toHaveTitle(title);
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

async function openStaffPage(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  role: "super_admin" | "finance",
  path: string
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "FOA Staff",
    grants: [{ role, scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await visit(page, path);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(path)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(path);
}

test("a super admin reads what cancelling would do, the form says what is wrong, and a cancelled competition says when and why", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await signInByCode(page, request, email, "Sunil Cancels");
  const openPath = `/admin/competitions/${SEEDED.open.id}/cancel`;

  // A member without a role is told the page isn't theirs.
  await visit(page, openPath);
  await expect(
    page.getByRole("heading", { level: 1, name: DENIED })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancel the/ })).toHaveCount(0);
  await expect(page).toHaveTitle(CANCEL_TITLE);
  await expectAccessible(page, "/admin/competitions/[id]/cancel, refused");

  // Granted super admin, they add an authenticator first.
  await grantGlobalRole(email, "super_admin");
  await visit(page, openPath);
  await expect(page).toHaveURL(/\/account\/security\?next=/);
  await page.getByRole("textbox", { name: "Name it" }).first().fill("Phone");
  await page.getByRole("button", { name: "Set up an app" }).click();
  const key = await page
    .getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    .textContent();
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(key ?? ""), new Date()));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(new RegExp(`${openPath}$`));

  await visit(page, "/dashboard");
  await page
    .getByRole("region", { name: "Admin", exact: true })
    .getByRole("link", { name: "Competitions", exact: true })
    .click();
  await expect(page).toHaveURL("/admin/competitions");
  await expect(
    page.getByRole("link", { name: `Edit ${SEEDED.open.name}` })
  ).toHaveCount(0);
  await page.getByRole("link", { name: `Cancel ${SEEDED.open.name}` }).click();
  await expect(page).toHaveURL(openPath);

  // What cancelling the open competition would do.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Cancel ${SEEDED.open.name}`,
    })
  ).toBeVisible();
  const effects = page.getByRole("region", { name: "What cancelling does" });
  await expect(effects).toContainText("told by email");
  await expect(effects).toContainText("refunded in all");
  await checkBothThemes(page, "/admin/competitions/[id]/cancel");

  // Sent without a reason: it says so, and cancels nothing.
  await page
    .getByRole("button", { name: "Cancel the competition for good" })
    .click();
  await expect(
    page.getByText("Write why the competition is cancelled.")
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Why is it cancelled?" })
  ).toHaveAttribute("aria-invalid", "true");
  await checkBothThemes(page, "/admin/competitions/[id]/cancel, no reason");
  await visit(page, openPath);
  await expect(
    page.getByRole("button", { name: "Cancel the competition for good" })
  ).toBeVisible();

  // The seeded cancelled competition: when and why, and no form.
  await visit(page, `/admin/competitions/${SEEDED.cancelled.id}/cancel`);
  const cancelled = page.getByRole("region", {
    name: "This competition is cancelled",
  });
  await expect(cancelled).toContainText("Cancelled on");
  await expect(cancelled).toContainText("The monsoon flooded the venue");
  await expect(
    page.getByRole("button", { name: "Cancel the competition for good" })
  ).toHaveCount(0);
  await checkBothThemes(page, "/admin/competitions/[id]/cancel, cancelled");

  // Its public page still lists it, saying it was cancelled.
  await visit(page, `/competitions/${SEEDED.cancelled.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    SEEDED.cancelled.name
  );
  await expect(
    page.getByText("This competition was cancelled").first()
  ).toBeVisible();
  await checkBothThemes(
    page,
    "/competitions/[slug], cancelled",
    `${SEEDED.cancelled.name} · Friends of Animals`
  );
});

test("cancellation rejects malformed input and refreshes warm public pages on success", async ({
  page,
  request,
  seedAccount,
  seedCompetition,
}) => {
  const competition = await seedCompetition("registration_open");
  const detail = `/competitions/${competition.slug}`;
  await visit(page, "/competitions");
  await expect(
    page.getByRole("heading", { name: SEEDED.open.name })
  ).toBeVisible();
  await visit(page, detail);
  await expect(
    page.getByRole("link", { name: "Register as an individual" })
  ).toBeVisible();

  await openStaffPage(
    page,
    request,
    seedAccount,
    "super_admin",
    `/admin/competitions/${competition.id}/cancel`
  );
  const reason = page.getByRole("textbox", { name: "Why is it cancelled?" });
  const submit = page.getByRole("button", {
    name: "Cancel the competition for good",
  });
  await reason.evaluate((field) => {
    field.closest("form")!.addEventListener(
      "formdata",
      (event) => {
        event.formData.set(
          "reason",
          new File(["A file is not a reason"], "reason.txt")
        );
      },
      { once: true }
    );
  });
  await submit.click();
  await expect
    .soft(page.getByText("Enter the cancellation reason as text."))
    .toBeVisible();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  const cancellationReason = "👩🏽‍❤️‍💋‍👨🏿".repeat(500);
  await reason.fill(cancellationReason);
  await expect.soft(reason).toHaveValue(cancellationReason);
  await submit.click();
  const cancelled = page.getByRole("region", {
    name: "This competition is cancelled",
  });
  await expect(cancelled).toBeVisible();
  await expect
    .soft(cancelled.getByText(`Why: ${cancellationReason}`, { exact: true }))
    .toBeVisible();

  await visit(page, detail);
  await expect
    .soft(page.getByText("This competition was cancelled").first())
    .toBeVisible();
  await expect
    .soft(page.getByRole("link", { name: "Register as an individual" }))
    .toHaveCount(0);
  await visit(page, "/competitions");
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: competition.name }) });
  await expect(card).toContainText("Cancelled");
});

test("a cancelled draft continues to return an HTTP 404 to visitors", async ({
  page,
  request,
  seedAccount,
  seedCompetition,
}) => {
  const draft = await seedCompetition("draft");
  const detail = `/competitions/${draft.slug}`;
  expect((await request.get(detail)).status()).toBe(404);

  await openStaffPage(
    page,
    request,
    seedAccount,
    "super_admin",
    `/admin/competitions/${draft.id}/cancel`
  );
  await page
    .getByRole("textbox", { name: "Why is it cancelled?" })
    .fill("The venue is closed.");
  await page
    .getByRole("button", { name: "Cancel the competition for good" })
    .click();
  await expect(
    page.getByRole("region", { name: "This competition is cancelled" })
  ).toBeVisible();

  expect((await request.get(detail)).status()).toBe(404);
});

test("finance sees and records a non-INR gateway dashboard refund", async ({
  page,
  request,
  seedAccount,
  baseURL,
}) => {
  const client = postgres(localSeedUrl(baseURL), { max: 1, prepare: false });
  const db = drizzle(client, { schema });
  const id = randomUUID();
  const batchId = randomUUID();
  const orderId = `order_fallback_${id}`;
  const paymentId = `pay_fallback_${id}`;
  const refundId = `rfnd_fallback_${id}`;
  const now = new Date();
  try {
    await db.insert(schema.gatewayTestOrder).values({
      id: orderId,
      amountMinor: 50_000n,
      receipt: batchId,
      createdAt: now,
    });
    await db.insert(schema.gatewayTestPayment).values({
      id: paymentId,
      orderId,
      status: "captured",
      amountMinor: 1_200n,
      currency: "USD",
      createdAt: now,
    });
    const [seeded] = await db
      .select()
      .from(schema.paymentBatch)
      .where(eq(schema.paymentBatch.id, SEED_PAYMENTS.paid.batchId));
    if (!seeded) throw new Error("No seeded payment batch");
    await db.insert(schema.paymentBatch).values({
      ...seeded,
      id: batchId,
      gateway: "fallback",
      gatewayOrderId: orderId,
      gatewayPaymentId: `pay_original_${id}`,
    });
    await db.insert(schema.paymentReviewCase).values({
      id,
      batchId,
      reason: "already_paid",
      gatewayPaymentId: paymentId,
      amountMinor: 1_200n,
      currency: "USD",
      batchStatusBefore: "captured",
      openedAt: now,
    });
    const path = `/admin/payments/review/${id}`;
    await openStaffPage(page, request, seedAccount, "finance", path);
    await expect
      .soft(page.getByRole("heading", { level: 1 }))
      .toHaveText("Payment of USD 12.00");
    await expect
      .soft(
        page
          .getByRole("region", { name: "What arrived" })
          .getByText("USD 12.00", { exact: true })
      )
      .toBeVisible();
    await visit(page, "/admin/payments/review");
    await expect
      .soft(page.locator(`a[href="${path}"]`))
      .toHaveText("USD 12.00");
    await visit(page, path);
    await page
      .getByRole("textbox", { name: "Reason" })
      .fill("The payer already paid the competition fee.");
    await page.getByRole("button", { name: "Refund it" }).click();
    const instruction = page.getByText(
      "Refund this payment in USD from the payment gateway dashboard.",
      { exact: true }
    );
    await expect(instruction).toBeVisible();
    await expect(page.getByText(/Refund started/)).toHaveCount(0);
    await visit(page, path);
    await expect(instruction).toBeVisible();
    await page
      .getByRole("textbox", { name: "Gateway refund reference" })
      .fill("rfnd_unverified");
    await page.getByRole("button", { name: "Record dashboard refund" }).click();
    await expect(
      page.getByText(
        "Enter the reference for a processed refund of this payment's full amount in its original currency."
      )
    ).toBeVisible();
    await expect(instruction).toBeVisible();

    await db.insert(schema.gatewayTestRefund).values({
      id: refundId,
      paymentId,
      status: "processed",
      amountMinor: 1_200n,
      currency: "USD",
      idempotencyKey: refundId,
      notes: {},
      createdAt: now,
    });
    await page
      .getByRole("textbox", { name: "Gateway refund reference" })
      .fill(refundId);
    await page.getByRole("button", { name: "Record dashboard refund" }).click();
    await expect(
      page.getByText("Dashboard refund recorded", { exact: true })
    ).toBeVisible();
    await expect(instruction).toHaveCount(0);
  } finally {
    try {
      await db
        .delete(schema.paymentReviewCase)
        .where(eq(schema.paymentReviewCase.id, id));
      await db
        .delete(schema.paymentBatch)
        .where(eq(schema.paymentBatch.id, batchId));
      await db
        .delete(schema.gatewayTestOrder)
        .where(eq(schema.gatewayTestOrder.id, orderId));
    } finally {
      await client.end({ timeout: 5 });
    }
  }
});
