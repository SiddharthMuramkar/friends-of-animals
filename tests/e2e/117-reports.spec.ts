import { expect, type Page } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_REPORT_COMPETITIONS } from "../../src/server/seed/competitions";
import { parseCsv } from "../../src/server/modules/registration/domain/csv";
import { test } from "./support/seed-account";
import { signInByCode, expectNoSidewaysScrollAt320 } from "./support/sign-in";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";

async function check(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
  await expectNoSidewaysScrollAt320(page, label);
}
async function passStaffGate(page: Page, secret: Uint8Array) {
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
}

test("staff go from dashboard through real waiting queues and download the aggregate detail", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Reports finance and admin",
    grants: [
      { role: "staff_admin", scope: { type: "global" } },
      { role: "finance", scope: { type: "global" } },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Admin home", exact: true }).click();
  await passStaffGate(page, secret);
  await expect(page).toHaveURL(/\/admin$/);
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", { name: "Admin home", exact: true })
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: /Institutions to verify/ })
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: /Artwork arriving/ })
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: /Refunds to approve/ })
  ).toContainText(/^[\s\S]*[1-9]\d* items? waiting/);
  await expect(
    main.getByRole("link", { name: /Safeguarding reports to review/ })
  ).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: /Entries to verify/ })
  ).toHaveCount(0);
  await check(page, "admin home");
  await main.getByRole("link", { name: /Results to approve/ }).click();
  await expect(
    main.getByRole("heading", { level: 1, name: "Results to approve" })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/queues\/results_to_approve$/);
  // Other isolated journeys may create their own draft release while this
  // preview runs. The exact global counts are proved at Seam 1; this
  // browser confirms the waiting list has its dedicated seeded release.
  await expect(
    main.getByRole("paragraph").filter({ hasText: /^[1-9]\d* items? waiting$/ })
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Open item RSLT27" })
  ).toHaveAttribute(
    "href",
    `/admin/competitions/${SEED_REPORT_COMPETITIONS[0].id}/results`
  );
  await check(page, "pending results queue");
  await main.getByRole("link", { name: "Open item RSLT27" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/competitions/${SEED_REPORT_COMPETITIONS[0].id}/results$`)
  );
  await page
    .getByRole("navigation", { name: "Admin", exact: true })
    .getByRole("link", { name: "Reports", exact: true })
    .click();
  await expect(
    main.getByRole("heading", { level: 1, name: "Competition reports" })
  ).toBeVisible();
  await check(page, "competition reports list");
  await expect(
    main.getByRole("link", { name: /Kinder Skies SKIES26/ })
  ).toBeVisible();
  // The dedicated report competition is unaffected by other test journeys
  // building payments against the existing Kinder Skies fee batch.
  await main.getByRole("link", { name: /Kindness in Words RSLT27/ }).click();
  const participation = main.getByRole("table", {
    name: "Participation by route and age group",
  });
  await expect(participation).toBeVisible();
  await expect(
    main.getByRole("table", { name: "Registration fees (INR)" })
  ).toContainText("₹0.00");
  await check(page, "competition report details");
  const href = await main
    .getByRole("link", { name: "Download CSV" })
    .getAttribute("href");
  expect(href).toBe("/admin/reports/competitions/RSLT27/export.csv");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(response.headers()["cache-control"]).toBe("no-store");
  const text = await response.text();
  expect(text).not.toContain("RSLT27-R-");
  expect(text).not.toContain("@example.test");
  expect(parseCsv(text)).toMatchObject({
    ok: true,
    records: expect.arrayContaining([
      ["individual", "Adults", "1", "1", "", "1", "0"],
      ["individual", "0.00", "0.00", "0.00"],
    ]),
  });
});

test("a scoped competition manager sees no other competition or safeguarding items", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Scoped reports manager",
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: SEED_REPORT_COMPETITIONS[0].id },
      },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin");
  await passStaffGate(page, secret);
  const main = page.locator("main");
  await expect(
    main.getByRole("link", { name: /Artwork arriving/ })
  ).toContainText("No items waiting");
  await expect(
    main.getByRole("link", { name: /Results to approve/ })
  ).toContainText("1 item waiting");
  for (const queue of [
    "Institutions to verify",
    "Entries to verify",
    "Refunds to approve",
    "Safeguarding reports to review",
  ])
    await expect(
      main.getByRole("link", { name: new RegExp(queue) })
    ).toHaveCount(0);
  await check(page, "scoped admin home");
  await page.goto("/admin/reports");
  await expect(
    main.getByRole("link", { name: /Kindness in Words RSLT27/ })
  ).toBeVisible();
  await expect(main.getByRole("link", { name: /Kinder Skies/ })).toHaveCount(0);
  await check(page, "scoped reports");
  const denied = await page.request.get(
    "/admin/reports/competitions/SKIES26/export.csv",
    { maxRedirects: 0 }
  );
  expect(denied.status()).toBe(403);
  await page.goto("/admin/queues/safeguarding_reports_to_review");
  await expect(
    main
      .getByText("You", { exact: false })
      .filter({ hasText: "Your account doesn't have a role" })
  ).toBeVisible();
  await expect(main.getByText("SG-26-SEED01")).toHaveCount(0);
});
