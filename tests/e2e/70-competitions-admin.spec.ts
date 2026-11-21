import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { base32Decode } from "../../src/server/second-factor/domain/base32";
import { totpCode } from "../../src/server/second-factor/domain/totp";
import { SEED_COMPETITION_MANAGERS } from "../../src/server/seed/competitions";
import { SEED_SCOPES } from "../../src/server/seed/scopes";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail, readCode } from "./support/mailbox";

// #70: a seeded competition manager signs in, passes the staff second
// factor (#60) with the seed authenticator and sees what the seeded draft
// still needs; then creates a draft, fills it in, previews it and
// publishes it. The four admin pages pass axe in light and dark. People
// without the role are refused, visitors sent to sign in. 70b adds the
// public page's side of the journey.
//
// An authenticator code works once, so each project signs in its own
// seeded manager, and only once. Sign-in codes: each project asks for two
// (its manager, a fresh member). Seeded addresses allow 5 codes in 15
// minutes, so one preview database takes two runs in 15 minutes.

/** Signs in by email code, read from the capture mailbox. */
async function signIn(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  // The code is stored before this shows, so the newest code is this one.
  await expect(page.getByRole("status")).toContainText(email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
}

/**
 * Signs this project's seeded competition manager in, then passes the
 * second factor the admin pages ask for, with the seed authenticator.
 */
async function signInAsManager(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo
) {
  const [desktop, mobile] = SEED_COMPETITION_MANAGERS;
  const manager = testInfo.project.name === "mobile" ? mobile : desktop;
  await signIn(page, request, manager.email);

  await page.goto("/admin/competitions");
  await expect(page).toHaveURL(
    /\/auth\/second-factor\?next=%2Fadmin%2Fcompetitions$/
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(SEED_TOTP_SECRET), new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/competitions$/);
}

/** A competition code nobody has used: 6 letters from the clock, then 27. */
function freshCode(): string {
  const letters = Date.now()
    .toString(26)
    .slice(-6)
    .replace(/[0-9a-p]/g, (digit) =>
      String.fromCharCode(65 + Number.parseInt(digit, 26))
    );
  return `${letters}27`;
}

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

test("a competition manager sees what a draft needs, then creates, edits, previews and publishes one", async ({
  page,
  request,
}, testInfo) => {
  await signInAsManager(page, request, testInfo);

  // The seeded draft has gaps: its preview lists what publishing needs.
  await expectRendersAccessibly(
    page,
    `/admin/competitions/${SEED_SCOPES.competition.id}/preview`
  );
  await expect(
    page.getByRole("heading", { name: "Before you can publish" })
  ).toBeVisible();
  await expect(page.getByText("Rules: fill this in.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expectAccessibleInDark(page, "the seeded draft's preview");

  // The list.
  await expectRendersAccessibly(page, "/admin/competitions");
  await expectAccessibleInDark(page, "/admin/competitions");
  await page.getByRole("link", { name: "New competition" }).click();

  // A new draft needs only a code and a name.
  await expect(page).toHaveURL(/\/admin\/competitions\/new$/);
  await checkBothThemes(page, "/admin/competitions/new");
  const code = freshCode();
  const name = `Wings over the Ghats ${code}`;
  await page.getByRole("textbox", { name: "Competition code" }).fill(code);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Save draft" }).click();

  // The edit form, with the draft saved.
  await expect(page).toHaveURL(/\/admin\/competitions\/[0-9a-f-]+\/edit\?/);
  await expect(page.getByRole("status")).toContainText("Draft saved.");
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await checkBothThemes(page, "/admin/competitions/[id]/edit");

  // A wrong date is refused against its own field, keeping what was typed.
  await page.getByRole("textbox", { name: "Theme" }).fill("Birds of the hills");
  await page
    .getByRole("textbox", { name: "Competition code" })
    .fill("NOT A CODE");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The competition code needs fixing."
  );
  await expect(page.getByRole("textbox", { name: "Theme" })).toHaveValue(
    "Birds of the hills"
  );
  await checkBothThemes(page, "/admin/competitions/[id]/edit with an error");

  // Everything publishing needs.
  await page.getByRole("textbox", { name: "Competition code" }).fill(code);
  await page
    .getByRole("textbox", { name: "Animal welfare message" })
    .fill("Leave water out for birds in summer.");
  await page.getByRole("radio", { name: "Individuals", exact: true }).check();
  await page.getByRole("checkbox", { name: "Drawing" }).check();
  await page.getByRole("button", { name: "Add an age group" }).click();
  const group = page.getByRole("group", { name: "Age group 1" });
  await group.getByRole("textbox", { name: "Label" }).fill("Juniors");
  await group.getByRole("textbox", { name: "Youngest age" }).fill("5");
  await group.getByRole("textbox", { name: "Oldest age" }).fill("10");
  await expect(
    page
      .getByRole("group", { name: "Drawing" })
      .getByRole("checkbox", { name: "Juniors" })
  ).toBeChecked();
  await page.getByLabel("Age cut-off date").fill("2027-06-01");
  await page.getByLabel("Registration opens (IST)").fill("2027-04-01T09:00");
  await page.getByLabel("Registration closes (IST)").fill("2027-05-01T17:30");
  await page.getByLabel("Submissions close (IST)").fill("2027-05-15T17:30");
  await page
    .getByRole("textbox", { name: "Rules", exact: true })
    .fill("One drawing each, your own work.");
  await page
    .getByRole("textbox", { name: "Permitted materials" })
    .fill("Pencil and crayons on A4 paper.");
  await page.getByRole("textbox", { name: "Duration" }).fill("1 hour");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved.");
  await expect(page.getByLabel("Registration opens (IST)")).toHaveValue(
    "2027-04-01T09:00"
  );

  // The preview, then publishing.
  await page.getByRole("link", { name: "Preview this competition" }).click();
  await expect(page).toHaveURL(/\/preview$/);
  await expect(
    page.getByRole("heading", { name: "Ready to publish" })
  ).toBeVisible();
  await expect(page.getByText("1 April 2027 at 9:00 am IST")).toBeVisible();
  await checkBothThemes(page, "/admin/competitions/[id]/preview");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toContainText("Published.");
  await expect(page.getByText("Published", { exact: true })).toBeVisible();

  // The list shows it published.
  await page
    .getByRole("link", { name: "Back to the competition list" })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: name })
  ).toContainText("Published");
});

test("a member without the role is refused, and a visitor is sent to sign in", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/admin/competitions");
  await expect(page).toHaveURL(/\/sign-in$/);

  // A fresh member: signing up, then the admin list.
  const email = freshEmail(testInfo.project.name);
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Kavya Menon");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);

  await page.goto("/admin/competitions");
  await expect(
    page.getByRole("heading", {
      name: "This page is for competition managers",
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "New competition" })).toHaveCount(
    0
  );
});
