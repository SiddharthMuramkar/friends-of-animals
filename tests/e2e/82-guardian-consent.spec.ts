import { expect } from "@playwright/test";

import { SEED_GUARDIANS } from "../../src/server/seed/guardians";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-guardian";
import { signInByCode } from "./support/sign-in";

test("a guardian changes one purpose, previews public credit, and reads the child's history", async ({
  page,
  request,
}) => {
  const child = SEED_GUARDIANS.children.young;
  await signInByCode(page, request, SEED_GUARDIANS.guardian.email);

  await page.goto(`/guardian/children/${child.profileId}`);
  const link = page.getByRole("link", { name: "Manage consents" });
  const path = `/guardian/children/${child.profileId}/consents`;
  await expect(link).toHaveAttribute("href", path);
  await expectRendersAccessibly(page, path);
  await expect(page).toHaveTitle(/Guardian consents/);
  await expectAccessibleInDark(page, path);

  const competition = page.getByRole("region", {
    name: "Neighbours on My Street",
    exact: true,
  });
  const credit = competition.getByRole("region", {
    name: "Neighbours on My Street Public credit",
    exact: true,
  });
  const gallery = credit.getByText("Gallery", { exact: true }).locator("..");
  const school = competition.getByRole("article", { name: "Show school" });
  await expect(gallery).toHaveText(/Isha D\..*Pune/);
  await expect(gallery).not.toContainText("Green Valley School");
  await expect(
    school.getByRole("link", { name: /read.*version/i })
  ).toHaveAttribute("href", /^\/documents\/public-display\/\d+$/);

  await school.getByRole("button", { name: "Give consent" }).click();
  await expect(page.getByRole("status")).toContainText("Consent recorded.");
  await expect(gallery).toContainText("Green Valley School");
  await expect(gallery).toContainText("Pune");
  await school.getByRole("button", { name: "Withdraw consent" }).click();
  await expect(page.getByRole("status")).toContainText("Consent withdrawn.");
  await expect(gallery).not.toContainText("Green Valley School");
  await expect(gallery).toContainText("Pune");

  const history = `${path}/history`;
  await expect(
    page.getByRole("link", { name: "View consent history" })
  ).toHaveAttribute("href", history);
  await expectRendersAccessibly(page, history);
  await expect(page).toHaveTitle(/Consent history/);
  const events = page.getByRole("main").getByRole("listitem");
  await expect(events.first()).toContainText("Withdrawn · Show school");
  await expect(events.first()).toContainText("Neighbours on My Street");
  await expect(events.first()).toContainText(/version \d+/);
  await expect(events.first()).toContainText("On this website");
  await expect(events.nth(1)).toContainText("Given · Show school");
  await expectAccessibleInDark(page, history);
});

test("a guardian can read consents and history before their child has registered anywhere", async ({
  page,
  request,
  seedGuardian,
}) => {
  const family = await seedGuardian({
    name: "E2E Guardian Ritu",
    children: [{ fullName: "Anu E2E", age: 9 }],
  });
  await signInByCode(page, request, family.email);
  const path = `/guardian/children/${family.childIds[0]}/consents`;
  await expectRendersAccessibly(page, path);
  await expect(
    page.getByText("There are no competition consents for this child yet.")
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Messages about your child" })
  ).toBeVisible();
  await expectRendersAccessibly(page, `${path}/history`);
  await expect(
    page.getByText(
      "No guardian consent has been given or withdrawn for this child yet."
    )
  ).toBeVisible();
});
