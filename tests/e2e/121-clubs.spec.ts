import { expect, type Page } from "@playwright/test";
import { test } from "./support/seed-account";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  expectNoSidewaysScrollAt320,
  newDevice,
  signInByCode,
} from "./support/sign-in";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_INSTITUTIONS } from "../../src/server/seed/institutions";
import { SEED_CLUB } from "../../src/server/seed/clubs";
async function check(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
  await expectNoSidewaysScrollAt320(page, label);
}
test("a student applies, the community manager enforces the cap, and members join and leave privately", async ({
  page,
  request,
  seedAccount,
  browser,
}, info) => {
  const email = await seedAccount({
    name: `Club applicant ${info.project.name}`,
    grants: [],
  });
  await signInByCode(page, request, email);
  await page.goto("/dashboard/community");
  await page.getByLabel("Display name (required)").fill("Animal friend");
  await page
    .getByRole("button", { name: "Join the community", exact: true })
    .click();
  await expect(page.getByText("Active member", { exact: true })).toBeVisible();
  await page.goto("/dashboard/clubs");
  await expect(
    page.getByRole("heading", { name: "Your applications and memberships" })
  ).toBeVisible();
  await check(page, "clubs dashboard");
  await page.getByRole("link", { name: "Apply to start a club" }).click();
  await expect(page.getByLabel("Institution (required)")).toBeVisible();
  await check(page, "club application");
  await page
    .getByLabel("Institution (required)")
    .selectOption(SEED_INSTITUTIONS.verified.id);
  await page.getByLabel("Your affiliation (required)").selectOption("student");
  const name = `Nature club ${info.project.name}`;
  await page.getByLabel("Club name (required)").fill(name);
  await page.getByRole("button", { name: "Submit club application" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByText("Awaiting review", { exact: true })
  ).toBeVisible();
  const applicantPage = new URL(page.url()).pathname;
  const id = applicantPage.split("/").at(-1)!;
  await check(page, "club applicant detail");
  const staff = await newDevice(browser, info);
  try {
    const secret = generateTotpSecret();
    const manager = await seedAccount({
      name: `Club manager ${info.project.name}`,
      grants: [{ role: "community_manager", scope: { type: "global" } }],
      totpSecret: secret,
    });
    await signInByCode(staff, request, manager);
    await staff.goto("/admin/community/clubs");
    await expect(staff).toHaveURL(/\/auth\/second-factor\?next=/);
    await staff
      .getByRole("textbox", { name: "6-digit code" })
      .fill(totpCode(secret, new Date()));
    await staff.getByRole("button", { name: "Continue" }).click();
    await expect(
      staff.getByRole("heading", { name: "Club review", level: 1 })
    ).toBeVisible();
    await check(staff, "club review list");
    await staff.getByRole("link", { name, exact: true }).click();
    await expect(
      staff.getByRole("heading", { name, exact: true })
    ).toBeVisible();
    await check(staff, "club review detail");
    await staff
      .getByRole("button", { name: "Approve club", exact: true })
      .click();
    await expect(
      staff.getByText(
        "This institution already has its maximum number of clubs."
      )
    ).toBeVisible();
    await staff
      .getByLabel("Decision note — Decline club")
      .fill("A club is already running at this school.");
    await staff
      .getByRole("button", { name: "Decline club", exact: true })
      .click();
    await expect(staff.getByText("Declined", { exact: true })).toBeVisible();
    await page.goto(`/dashboard/clubs/${id}`);
    await expect(page.getByText("Declined", { exact: true })).toBeVisible();
    await page.goto(`/dashboard/clubs/${SEED_CLUB.id}`);
    await expect(
      page.getByRole("heading", { name: SEED_CLUB.name, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Club members", exact: true })
    ).toHaveCount(0);
    await page
      .getByLabel("Your affiliation (required)")
      .selectOption("student");
    await page.getByRole("button", { name: "Join club", exact: true }).click();
    await expect(
      page.getByText("You are a member of this club.")
    ).toBeVisible();
    await check(page, "approved club membership detail");
    await page.getByRole("button", { name: "Leave club", exact: true }).click();
    await expect(
      page.getByText("You left the club.", { exact: true })
    ).toBeVisible();
    await page.goto("/dashboard/timeline");
    await expect(
      page.getByText("Joined an FOA club", { exact: true })
    ).toHaveCount(1);
    await expect(
      page.getByText("Left an FOA club", { exact: true })
    ).toHaveCount(1);
    await staff.goto(`/admin/community/clubs/${SEED_CLUB.id}`);
    await expect(
      staff.getByRole("heading", { name: "Club members", exact: true })
    ).toBeVisible();
    await expect(
      staff.getByText(`Club applicant ${info.project.name}`, { exact: true })
    ).toBeVisible();
  } finally {
    await staff.context().close();
  }
});
