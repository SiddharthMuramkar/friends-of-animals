import { expect, type Page } from "@playwright/test";
import { test } from "./support/seed-guardian";
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
import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";

async function check(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
  await expectNoSidewaysScrollAt320(page, label);
}

test("a finalist applies, the manager approves or declines, and the applicant sees the private result", async ({
  page,
  request,
  browser,
  seedAccount,
}, info) => {
  await signInByCode(page, request, SEED_ACCOUNTS.members[0].email);
  await page.goto("/dashboard/community");
  await page
    .getByRole("link", { name: "FOA Ambassadors", exact: true })
    .click();
  await expect(
    page.getByText("You meet the current eligibility requirements.")
  ).toBeVisible();
  await check(page, "eligible ambassador application");
  await page
    .getByRole("button", { name: "Apply to become an FOA Ambassador" })
    .click();
  await expect(
    page.getByText("Your application was sent to the community team.")
  ).toBeVisible();
  await expect(
    page.getByText("Awaiting review", { exact: true })
  ).toBeVisible();
  await check(page, "ambassador application submitted");
  const manager = await newDevice(browser, info);
  const volunteer = await newDevice(browser, info);
  try {
    const secret = generateTotpSecret();
    const email = await seedAccount({
      name: `Ambassador reviewer ${info.project.name}`,
      grants: [{ role: "community_manager", scope: { type: "global" } }],
      totpSecret: secret,
    });
    await signInByCode(manager, request, email);
    await manager.goto("/admin/community/ambassadors");
    await expect(manager).toHaveURL(/\/auth\/second-factor\?next=/);
    await manager
      .getByRole("textbox", { name: "6-digit code" })
      .fill(totpCode(secret, new Date()));
    await manager.getByRole("button", { name: "Continue" }).click();
    await expect(manager).toHaveURL(/\/admin\/community\/ambassadors$/);
    await expect(
      manager.getByRole("heading", {
        name: "Ambassador applications",
        level: 1,
      })
    ).toBeVisible();
    await expect(
      manager.getByRole("heading", { name: "Asha Rao", exact: true })
    ).toBeVisible();
    await expect(
      manager.getByRole("heading", { name: "Priya Nair", exact: true })
    ).toBeVisible();
    await check(manager, "ambassador review queue");
    await manager
      .getByRole("button", { name: "Approve Asha Rao’s application" })
      .click();
    await expect(
      manager.getByText(
        "Application approved. The ambassador milestone was recorded."
      )
    ).toBeVisible();
    await manager
      .getByLabel("Reason for decline (required)")
      .fill("Please complete the outreach orientation first.");
    await manager
      .getByRole("button", { name: "Decline Priya Nair’s application" })
      .click();
    await expect(
      manager.getByText(
        "Application declined. The reason was recorded and the applicant will be notified."
      )
    ).toBeVisible();
    await manager.getByLabel("Filter by status").selectOption("all");
    await manager.getByRole("button", { name: "Show applications" }).click();
    await expect(
      manager.getByText("Please complete the outreach orientation first.")
    ).toBeVisible();
    await check(manager, "reviewed ambassador applications");
    await page.reload();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await check(page, "approved ambassador");
    await page
      .getByRole("link", { name: "View your engagement timeline" })
      .click();
    await expect(
      page.getByText("Became an ambassador", { exact: true })
    ).toHaveCount(1);
    await check(page, "ambassador timeline");
    await signInByCode(volunteer, request, "volunteer1@example.test");
    await volunteer.goto("/dashboard/ambassadors");
    await expect(
      volunteer.getByText("Declined", { exact: true })
    ).toBeVisible();
    await expect(
      volunteer.getByText("Please complete the outreach orientation first.")
    ).toBeVisible();
    await check(volunteer, "declined ambassador");
  } finally {
    await manager.context().close();
    await volunteer.context().close();
  }
});

test("a new member cannot apply and cannot access a manager's queue", async ({
  page,
  request,
  seedAccount,
}, info) => {
  const email = await seedAccount({
    name: `Ineligible member ${info.project.name}`,
    grants: [],
  });
  await signInByCode(page, request, email);
  await page.goto("/dashboard/ambassadors");
  await expect(
    page.getByText("You do not meet all the current eligibility requirements.")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply to become an FOA Ambassador" })
  ).toHaveCount(0);
  await check(page, "ineligible ambassador");
  await page.goto("/admin/community/ambassadors");
  await expect(page.getByText("Asha Rao", { exact: true })).toHaveCount(0);
});
