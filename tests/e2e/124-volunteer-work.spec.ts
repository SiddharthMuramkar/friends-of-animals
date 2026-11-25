import { expect, type Page } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { test } from "./support/seed-guardian";
import { signInByCode } from "./support/sign-in";
import { istDate } from "../../src/server/modules/volunteers/domain/hours";

async function check(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/
  );
  const original = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    `${label} at 320px`
  ).toBe(true);
  if (original) await page.setViewportSize(original);
}

test("manager creates, publishes, assigns and tracks a task", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  const volunteerName = `Service helper ${testInfo.project.name}`;
  await seedAccount({
    name: volunteerName,
    grants: [{ role: "volunteer", scope: { type: "global" } }],
  });
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `Service manager ${testInfo.project.name}`,
    grants: [{ role: "community_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/volunteers/tasks");
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Volunteer tasks" })
  ).toBeVisible();
  await check(page, "task list");
  await page.getByRole("link", { name: "Create a task" }).click();
  await check(page, "create task");
  const title = `Awareness material ${testInfo.project.name}`;
  await page.getByLabel("Task title (required)").fill(title);
  await page
    .getByLabel("Work instructions (required)")
    .fill("Prepare posters for a community activity.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: title })
  ).toBeVisible();
  await check(page, "task detail draft");
  await page.getByRole("button", { name: "Publish task" }).click();
  await page
    .getByLabel("Volunteer (required)")
    .selectOption({ label: volunteerName });
  await page.getByRole("button", { name: "Assign volunteer" }).click();
  await expect(
    page.getByRole("button", { name: `Remove assignment ${volunteerName}` })
  ).toBeVisible();
  await check(page, "task detail assigned");
  await page.getByRole("button", { name: "Cancel task" }).click();
  await expect(
    page
      .getByRole("region", { name: "Task details" })
      .getByText("Cancelled", { exact: true })
  ).toBeVisible();
});

test("volunteer logs service and requests an approved-hours certificate through the existing pipeline", async ({
  page,
  request,
}) => {
  await signInByCode(page, request, "volunteer1@example.test");
  await page.goto("/dashboard/volunteer/tasks");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your assigned tasks" })
  ).toBeVisible();
  await check(page, "assigned tasks");
  await page.getByRole("link", { name: "Your service hours" }).click();
  await check(page, "service hours");
  await page
    .getByLabel("Task (required)")
    .selectOption({ label: "Help at the awareness stall" });
  await page
    .getByLabel("Date worked (IST, required)")
    .fill(istDate(new Date()));
  await page.getByLabel("Minutes worked (required)").fill("25");
  await page
    .getByLabel("Work note (optional)")
    .fill("Completed additional demo service");
  await page.getByRole("button", { name: "Log hours" }).click();
  await expect(
    page.getByText("Completed additional demo service", { exact: true }).last()
  ).toBeVisible();
  await page.getByRole("link", { name: "Service certificate" }).click();
  await check(page, "request certificate");
  await expect(
    page.getByRole("heading", { name: "Approved service: 2 hours 25 minutes" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Request certificate" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page
    .getByRole("link", { name: "View and download certificates" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Volunteer service", exact: true })
  ).toBeVisible();
  await check(page, "certificate download");
  // The real renderer is optional in CI. When supplied, the generated
  // certificate reaches ready state and the same private endpoint downloads it.
  if (await page.getByRole("link", { name: /Download PDF/ }).count()) {
    const link = page.getByRole("link", { name: /Download PDF/ }).first();
    const href = await link.getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  }
  const qrPath = await page
    .getByRole("link", { name: /Verify certificate/ })
    .first()
    .getAttribute("href");
  if (!qrPath) throw Error("Certificate QR path missing");
  await page.goto(qrPath);
  await expect(
    page.getByRole("heading", { name: "Valid certificate" })
  ).toBeVisible();
  await expect(
    page.getByText("Approved service: 2 hours 25 minutes")
  ).toBeVisible();
  await expect(page.getByText("Name withheld")).toBeVisible();
  await check(page, "service QR verification");
});

test("community manager reviews the private service hours and certificates", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `Hours manager ${testInfo.project.name}`,
    grants: [{ role: "community_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/volunteers/hours");
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review volunteer hours", level: 1 })
  ).toBeVisible();
  await check(page, "review hours and certificates");
  await expect(
    page.getByText("Awaiting review", { exact: false }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Volunteer certificates" })
  ).toBeVisible();
});
