import { expect, test } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { grantGlobalRole } from "./support/roles";
import { signInByCode } from "./support/sign-in";

// #116: the public "report a concern" form and the safeguarding lead's
// pages. The form is prerendered with the Quick exit bar and works without
// an account; its island solves a real proof-of-work challenge and waits
// out the 3-second bot screen before it sends, so each send can take a few
// seconds on CI. The confirmation page shows nothing of the report. The
// leads' alert is proved at Seam 1 (a preview's worker may lag, HR-10).
//
// Only a safeguarding lead reads reports: a fresh member is refused, and,
// once granted the role, adds an authenticator at #60's staff gate (the
// seeded lead's authenticator would clash with other runs: a code works
// once). The lead reads the seeded resolved report, which no step can
// change, and adds a note: the log only grows, so runs can't disturb each
// other. Who else is refused (super admins included) is proved at Seam 1.

const DESCRIPTION = "Kingfisher badge description for the journey";

test("a visitor reports a concern without an account and sees nothing of it afterwards", async ({
  page,
}) => {
  await page.goto("/safeguarding");
  await page.getByRole("link", { name: "Report a concern" }).first().click();
  await expect(page).toHaveURL(/\/safeguarding\/report$/);

  await expectRendersAccessibly(page, "/safeguarding/report");
  await expectAccessibleInDark(page, "/safeguarding/report");
  await expect(page.getByRole("link", { name: "Quick exit" })).toBeVisible();

  // Error state: nothing chosen or written.
  const send = page.getByRole("button", { name: "Send report" });
  await send.click();
  await expect(page.getByText("Choose what it’s about.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Tell us what happened, in up to 5,000 characters.")
  ).toBeVisible();
  await expectAccessible(page, "/safeguarding/report, errors");
  await expectAccessibleInDark(page, "/safeguarding/report, errors");

  // Anonymous by default: no name or contact to fill in until unticked.
  await expect(
    page.getByRole("checkbox", { name: "Keep me anonymous" })
  ).toBeChecked();
  await expect(
    page.getByRole("textbox", { name: "Your name (optional)" })
  ).toHaveCount(0);

  await page.getByRole("radio", { name: "Bullying" }).check();
  await page
    .getByRole("textbox", { name: "What happened, or what worries you?" })
    .fill(DESCRIPTION);
  await page
    .getByRole("combobox", { name: "How old is the child? (optional)" })
    .selectOption({ label: "11 years old" });
  await send.click();

  // The confirmation: the same for every report, with Quick exit.
  await expect(page).toHaveURL(/\/safeguarding\/report\/sent$/, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "Thank you for telling us" })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Quick exit" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Kingfisher");
  await expect(page.locator("body")).not.toContainText(/SG-\d{2}-/);
  await expectAccessible(page, "/safeguarding/report/sent");
  await expectAccessibleInDark(page, "/safeguarding/report/sent");
});

test("only a safeguarding lead reads reports, and adds to a report's log", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await signInByCode(page, request, email, "Asha Rao");

  // A member without the role is told the page isn't theirs.
  await page.goto("/admin/safeguarding");
  await expect(
    page.getByRole("heading", {
      name: "Only a safeguarding lead can open this",
    })
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expectAccessible(page, "/admin/safeguarding, refused");

  // Granted the role, they add an authenticator at the staff gate first.
  await grantGlobalRole(email, "safeguarding_lead");
  await page.goto("/admin/safeguarding");
  await expect(page).toHaveURL(
    /\/account\/security\?next=%2Fadmin%2Fsafeguarding$/
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
  await expect(page).toHaveURL(/\/admin\/safeguarding$/);

  // The open queue, then the resolved one, which holds the seeded report.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Safeguarding reports"
  );
  await expectAccessible(page, "/admin/safeguarding");
  await expectAccessibleInDark(page, "/admin/safeguarding");
  await page.getByRole("link", { name: "Resolved" }).click();
  await expect(page).toHaveURL(/\/admin\/safeguarding\?view=resolved$/);
  await page.getByRole("link", { name: "SG-26-SEED03" }).click();
  await expect(page).toHaveURL(/\/admin\/safeguarding\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Report SG-26-SEED03" })
  ).toBeVisible();
  await expect(
    page.getByText("This report is resolved, so it can’t move on.", {
      exact: false,
    })
  ).toBeVisible();
  await expectAccessible(page, "/admin/safeguarding/[id]");
  await expectAccessibleInDark(page, "/admin/safeguarding/[id]");

  await page
    .getByRole("textbox", { name: "Add a note" })
    .fill(`Checked again by ${testInfo.project.name}`);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your note is in the log."
  );
  await expect(
    page.getByText(`Checked again by ${testInfo.project.name}`).first()
  ).toBeVisible();
  await expectAccessible(page, "/admin/safeguarding/[id], noted");
});
