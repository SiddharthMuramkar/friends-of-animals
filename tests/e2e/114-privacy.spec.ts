import { expect } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

const PRIVACY = "/admin/privacy";
const SETTINGS = "/admin/settings";

test("a super admin reads the privacy inventory and places and releases a legal hold", async ({
  page,
  request,
  seedAccount,
}, { project }) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Privacy administrator",
    grants: [{ role: "super_admin", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(PRIVACY);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(PRIVACY)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(PRIVACY);

  await expectRendersAccessibly(page, PRIVACY);
  await expect(page).toHaveTitle(/^Data inventory\b/);
  await expect(
    page.getByRole("link", { name: "Data inventory" })
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "Change the periods in the settings" })
  ).toHaveAttribute("href", SETTINGS);
  const inventory = page.getByRole("region", { name: "Personal data fields" });
  const notes = inventory.locator("details").filter({
    has: page.locator("summary").getByText("contact_note", { exact: true }),
  });
  await notes.locator("summary").click();
  await expect(
    notes.getByText("What staff noted while handling the message")
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Change the periods in the settings" })
    .click();
  const captures = page.getByRole("article", {
    name: "Keep captured test messages",
  });
  const days = captures.getByRole("spinbutton", { name: "New value, in days" });
  const initialDays = await days.inputValue();
  const newDays = initialDays === "45" ? "46" : "45";
  const saveDays = async (value: string) => {
    await days.fill(value);
    await captures.getByRole("button", { name: "Save" }).click();
    await expect(captures.getByRole("status")).toContainText(
      "Saved. The new value applies now."
    );
  };
  try {
    await saveDays(newDays);
    await page.goto(PRIVACY);
    const policies = page.getByRole("region", { name: "Retention policies" });
    await expect(
      policies
        .getByRole("row", { name: /Captured test messages/ })
        .getByText(
          `Deleted ${newDays} days after capture. Only local runs and previews capture messages.`
        )
    ).toBeVisible();
  } finally {
    await page.goto(SETTINGS);
    if ((await days.inputValue()) !== initialDays) {
      await saveDays(initialDays);
      await page.reload();
    }
    await expect(days).toHaveValue(initialDays);
  }
  await page.goto(PRIVACY);

  const holds = page.getByRole("region", { name: "Legal holds in force" });
  const subject = SEED_ACCOUNTS.members[project.name === "desktop" ? 0 : 1];
  const reason = `Pending inquiry (${project.name})`;
  await holds.getByLabel("Subject type").selectOption("user");
  await holds.getByRole("textbox", { name: "Subject ID" }).fill(subject.id);
  await holds.getByRole("textbox", { name: "Reason" }).fill(reason);
  await holds.getByRole("button", { name: "Place hold" }).click();
  await expect(holds.getByRole("status")).toContainText(
    "The hold is in force."
  );

  const hold = holds.getByRole("listitem").filter({ hasText: reason });
  await expect(hold).toContainText(subject.id);
  await expectAccessibleInDark(page, PRIVACY);
  await hold.getByRole("button", { name: "Release hold" }).click();
  await expect(hold).toHaveCount(0);
});
