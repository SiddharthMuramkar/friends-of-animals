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
import { SEED_GUARDIANS } from "../../src/server/seed/guardians";

async function check(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
  await expectNoSidewaysScrollAt320(page, label);
}
test("a member joins, edits, leaves and rejoins with only one private milestone", async ({
  page,
  request,
  seedAccount,
}, info) => {
  const name = `Community ${info.project.name}`;
  const email = await seedAccount({ name, grants: [] });
  await signInByCode(page, request, email);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Your community", exact: true }).click();
  await expect(page.getByText("Not a member", { exact: true })).toBeVisible();
  await check(page, "community join");
  await page.getByLabel("Display name (required)").fill(name);
  await page.getByLabel("About you (optional)").fill("I care about animals.");
  await page
    .getByRole("button", { name: "Join the community", exact: true })
    .click();
  await expect(page.getByText("Active member", { exact: true })).toBeVisible();
  await check(page, "active membership");
  await page.getByLabel("Display name (required)").fill(`${name} edit`);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Your member profile was saved.")).toBeVisible();
  await page
    .getByRole("link", { name: "View your engagement timeline" })
    .click();
  await expect(
    page.getByText("Joined the FOA community", { exact: true })
  ).toHaveCount(1);
  await check(page, "engagement timeline");
  await page
    .getByRole("link", { name: "Manage your community membership" })
    .click();
  await page
    .getByRole("button", { name: "Leave the community", exact: true })
    .click();
  await expect(page.getByText("Former member", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Rejoin the community", exact: true })
    .click();
  await expect(page.getByText("Active member", { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "View your engagement timeline" })
    .click();
  await expect(
    page.getByText("Joined the FOA community", { exact: true })
  ).toHaveCount(1);
});
test("published results appear in adult and linked child timelines", async ({
  page,
  request,
  browser,
}, info) => {
  await signInByCode(page, request, SEED_ACCOUNTS.members[0].email);
  await page.goto("/dashboard/timeline");
  await expect(
    page.getByText("Art for kindness", { exact: true }).first()
  ).toBeVisible();
  const adultFinalist = page
    .getByRole("listitem")
    .filter({
      has: page.getByText("Art for kindness", { exact: true }),
    })
    .filter({ has: page.getByText("Became a FOA finalist", { exact: true }) });
  await expect(adultFinalist).toHaveCount(1);
  await expect(adultFinalist).toBeVisible();
  await check(page, "seeded adult history");
  const guardian = await newDevice(browser, info);
  try {
    await signInByCode(guardian, request, SEED_GUARDIANS.guardian.email);
    await guardian.goto(
      `/guardian/children/${SEED_GUARDIANS.children.teen.profileId}`
    );
    await guardian.getByRole("link", { name: "Engagement timeline" }).click();
    await expect(
      guardian.getByRole("heading", {
        name: "Rohan Desai’s engagement timeline",
      })
    ).toBeVisible();
    const teenFinalist = guardian
      .getByRole("listitem")
      .filter({
        has: guardian.getByText("Art for kindness", { exact: true }),
      })
      .filter({
        has: guardian.getByText("Became a FOA finalist", { exact: true }),
      });
    await expect(teenFinalist).toHaveCount(1);
    await expect(teenFinalist).toBeVisible();
    await check(guardian, "linked teen timeline");
    await guardian.goto(
      `/guardian/children/${SEED_GUARDIANS.children.young.profileId}/timeline`
    );
    await expect(
      guardian.getByText("Joined the FOA community", { exact: true })
    ).toBeVisible();
    await check(guardian, "accountless child timeline");
  } finally {
    await guardian.context().close();
  }
});
test("community staff can list private members after second factor", async ({
  page: staff,
  request,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `Community staff ${info.project.name}`,
    grants: [{ role: "community_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(staff, request, email);
  await staff.goto("/admin/community/members");
  await expect(staff).toHaveURL(/\/auth\/second-factor\?next=/);
  await staff
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await staff.getByRole("button", { name: "Continue" }).click();
  await expect(staff).toHaveURL(/\/admin\/community\/members$/);
  await expect(
    staff.getByRole("heading", { name: "Community members", level: 1 })
  ).toBeVisible();
  await expect(staff.getByRole("heading", { name: "Asha Rao" })).toBeVisible();
  await check(staff, "community member directory");
});
