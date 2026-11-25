import { expect, type Page } from "@playwright/test";
import { test } from "./support/seed-account";
import { signInByCode, expectNoSidewaysScrollAt320 } from "./support/sign-in";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { istDateOf } from "../../src/server/modules/ledger/domain/period";
import { parseCsv } from "../../src/server/modules/registration/domain/csv";

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

test("leadership can inspect all objective categories over chosen dates and download aggregate CSV", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Objective report leader",
    grants: [{ role: "staff_admin", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/reports");
  await passStaffGate(page, secret);
  const main = page.locator("main");
  await main.getByRole("link", { name: "View objective reports" }).click();
  await expect(
    main.getByRole("heading", { level: 1, name: "Objective reports" })
  ).toBeVisible();
  for (const heading of [
    "Participation",
    "Engagement",
    "Institution partnerships",
    "Volunteer involvement",
    "Donations (INR)",
    "Participant feedback",
    "Social-media reach and trends",
  ]) {
    await expect(
      main.getByRole("heading", { level: 2, name: heading, exact: true })
    ).toBeVisible();
  }
  const table = main.getByRole("table", {
    name: "Social-media reach and trends",
  });
  await expect(table.getByRole("rowheader", { name: "Instagram" })).toHaveCount(
    3
  );
  await expect(table).toContainText("240");
  await check(page, "objective reports");
  // Period that contains the historical pilot and both types of source
  // observation but does not depend on any parallel journey's new data.
  const today = istDateOf(new Date());
  const earlier = istDateOf(new Date(Date.now() - 130 * 86_400_000));
  await main.getByLabel("From date (IST)").fill(earlier);
  await main.getByLabel("Through date (IST)").fill(today);
  await main.getByRole("button", { name: "Apply period" }).click();
  await expect(page).toHaveURL(/\?from=/);
  const href = await main
    .getByRole("link", { name: "Download CSV" })
    .getAttribute("href");
  expect(href).toContain(`from=${earlier}`);
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  expect(csv.headers()["cache-control"]).toBe("no-store");
  const text = await csv.text();
  expect(text).not.toContain("@example.test");
  expect(text).not.toContain("FOA-P-");
  expect(text).not.toContain("KIND27-R-");
  const parsed = parseCsv(text);
  if (!parsed.ok) throw Error(parsed.reason);
  expect(parsed.records).toEqual(
    expect.arrayContaining([
      ["from_ist", "to_ist"],
      [earlier, today],
      ["participation", "participants", expect.stringMatching(/^[1-9]\d*$/)],
      ["engagement", "school_winner", expect.stringMatching(/^[1-9]\d*$/)],
      ["engagement", "ambassador", expect.stringMatching(/^[1-9]\d*$/)],
      ["partnerships", "verifiedSchools", expect.stringMatching(/^[1-9]\d*$/)],
      ["volunteers", "approvedMinutes", expect.stringMatching(/^[1-9]\d*$/)],
      ["donations", "refunded_inr", expect.stringMatching(/^[1-9]\d*\.\d{2}$/)],
      ["feedback", "responses", expect.stringMatching(/^[1-9]\d*$/)],
      [
        "instagram",
        expect.any(String),
        "240",
        "45",
        "8",
        "1100",
        "1500",
        "120",
      ],
    ])
  );
});

test("content manager records an aggregate channel observation without leadership access", async ({
  page,
  request,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Social metrics editor",
    grants: [{ role: "content_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin");
  await passStaffGate(page, secret);
  await page
    .getByRole("navigation", { name: "Admin", exact: true })
    .getByRole("link", { name: "Social metrics", exact: true })
    .click();
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "Social metrics" })
  ).toBeVisible();
  await check(page, "social metrics form and seeded trend");
  const channel = info.project.name.includes("mobile")
    ? "linkedin"
    : "facebook";
  const label = channel === "linkedin" ? "LinkedIn" : "Facebook";
  const today = istDateOf(new Date());
  await main.getByLabel("Channel (required)").selectOption(channel);
  await main.getByLabel("Observation date (IST) (required)").fill(today);
  await main.getByLabel("Followers (required)").fill("321");
  await main.getByLabel("Posts (required)").fill("4");
  await main.getByLabel("Reach (optional)").fill("900");
  await main.getByRole("button", { name: "Save observation" }).click();
  await expect(main.getByRole("status")).toContainText("Observation saved");
  const row = main
    .getByRole("row")
    .filter({ has: main.getByRole("rowheader", { name: label, exact: true }) });
  await expect(row).toContainText("321");
  await expect(row).toContainText("900");
  const href = await main
    .getByRole("link", { name: "Download CSV" })
    .getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(`${channel},${today},321,,4,900,,`);
  await expect(
    main.getByRole("link", { name: "View objective reports" })
  ).toHaveCount(0);
  const denied = await page.request.get(
    `/admin/reports/objectives/export.csv?from=${today}&to=${today}`,
    { maxRedirects: 0 }
  );
  expect(denied.status()).toBe(403);
  await page.goto("/admin/reports/objectives");
  await expect(
    main.getByText(/Your account doesn't have a role/)
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Participation", exact: true })
  ).toHaveCount(0);
  await check(page, "denied objective reports");
});
