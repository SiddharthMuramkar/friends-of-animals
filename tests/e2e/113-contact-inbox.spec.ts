import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail, readCode } from "./support/mailbox";
import { grantGlobalRole } from "./support/roles";

// #113: the public contact form on the prerendered /contact page, in its
// empty, error and success states. The island solves a real proof-of-work
// challenge (16 bits) in the browser. The acknowledgement email is proved
// at Seam 1 (a preview's worker may lag M5's tip, HR-10), so this only
// checks what the sender sees. Each run uses a fresh address, so the
// per-address limit never trips; previews allow 100 per IP an hour, since
// every run comes from the CI runner's one address.

const REFERENCE = /CM-\d{2}-[0-9A-HJKMNP-TV-Z]{6}/;

test("a visitor sends a message through the contact form", async ({
  page,
}, testInfo) => {
  await expectRendersAccessibly(page, "/contact");
  await expectAccessibleInDark(page, "/contact");
  const form = page
    .getByRole("region", { name: "Send us a message" })
    .locator("form");

  // Error state: nothing chosen or filled in. The island solves its
  // challenge before it sends, which can take a few seconds on CI.
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(
    form.getByText("Choose what your message is about.")
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    form.getByText("Enter your name, in up to 100 characters.")
  ).toBeVisible();
  await expectAccessible(page, "/contact, errors");
  await expectAccessibleInDark(page, "/contact, errors");

  // Safeguarding sends people to the right page instead of the form.
  await form.getByRole("radio", { name: "Safeguarding concern" }).check();
  await expect(
    form.getByRole("link", { name: "Go to the safeguarding page" })
  ).toBeVisible();
  await expect(form.getByRole("button", { name: "Send message" })).toHaveCount(
    0
  );

  await form.getByRole("radio", { name: "Schools" }).check();
  await form.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  await form
    .getByRole("textbox", { name: "Your email address" })
    .fill(freshEmail(testInfo.project.name));
  await form
    .getByRole("textbox", { name: "School or organisation (optional)" })
    .fill("Green Valley School, Pune");
  await form
    .getByRole("textbox", { name: "Subject" })
    .fill("A competition at our school");
  await form
    .getByRole("textbox", { name: "Your message" })
    .fill("We would like to bring the competition to classes 6 to 8.");
  await form.getByRole("button", { name: "Send message" }).click();

  // Success state: the reference, in place of the form.
  const done = page.getByRole("status").filter({ hasText: "Your reference" });
  await expect(done).toContainText(REFERENCE, { timeout: 30_000 });
  await expectAccessible(page, "/contact, sent");
  await expectAccessibleInDark(page, "/contact, sent");

  await page.getByRole("button", { name: "Send another message" }).click();
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue(
    ""
  );
});

/**
 * Sends a General message as a visitor who first forgets the message, then
 * writes it; returns its reference. The refused send leaves its proof
 * unspent, and the island sends it again, so the bot screen counts from
 * when the visitor started (it drops anything sent within 3 s of that).
 */
async function sendMessage(page: Page, testInfo: TestInfo, subject: string) {
  await page.goto("/contact");
  const form = page
    .getByRole("region", { name: "Send us a message" })
    .locator("form");
  await form.getByRole("radio", { name: "General" }).check();
  await form.getByRole("textbox", { name: "Your name" }).fill("Kavya Menon");
  await form
    .getByRole("textbox", { name: "Your email address" })
    .fill(freshEmail(testInfo.project.name));
  await form.getByRole("textbox", { name: "Subject" }).fill(subject);
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(
    form.getByText("Enter your message, in up to 5,000 characters.")
  ).toBeVisible({ timeout: 30_000 });
  // Writing the message takes a person more than the screen's 3 s.
  await page.waitForTimeout(3_000);
  await form
    .getByRole("textbox", { name: "Your message" })
    .fill("How can I help at the next adoption camp?");
  await form.getByRole("button", { name: "Send message" }).click();
  const done = page.getByRole("status").filter({ hasText: "Your reference" });
  await expect(done).toContainText(REFERENCE, { timeout: 30_000 });
  return (await done.textContent())!.match(REFERENCE)![0];
}

/**
 * A new staff admin, made for this test and project as the preview seed
 * makes its staff (a code of the seeded staff's authenticator works once,
 * and other journeys use theirs), who adds an authenticator at #60's
 * staff gate on the way into the inbox.
 */
async function newStaffAdmin(
  page: Page,
  request: Parameters<typeof readCode>[0],
  testInfo: TestInfo,
  name: string
) {
  const email = freshEmail(testInfo.project.name);
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
  await grantGlobalRole(email, "staff_admin");

  await page.goto("/admin/inbox");
  await expect(page).toHaveURL(/\/account\/security\?next=%2Fadmin%2Finbox$/);
  await page.getByRole("textbox", { name: "Name it" }).first().fill("Phone");
  await page.getByRole("button", { name: "Set up an app" }).click();
  const key = await page
    .getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    .textContent();
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(key ?? ""), new Date()));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
}

test("a staff admin assigns, notes and closes a message in the inbox", async ({
  page,
  request,
}, testInfo) => {
  // A message of this test's own, so the shared seed data stays as it is.
  const subject = `Helping at camp (${testInfo.project.name})`;
  const reference = await sendMessage(page, testInfo, subject);
  const staffName = `Leela Das (${testInfo.project.name})`;
  await newStaffAdmin(page, request, testInfo, staffName);

  await expectRendersAccessibly(page, "/admin/inbox");
  await expectAccessibleInDark(page, "/admin/inbox");
  await page
    .getByRole("listitem")
    .filter({ hasText: reference })
    .getByRole("link", { name: subject })
    .click();
  await expect(page).toHaveURL(/\/admin\/inbox\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject);
  await expectAccessible(page, "/admin/inbox/[id]");
  await expectAccessibleInDark(page, "/admin/inbox/[id]");

  const assignee = page.getByRole("region", { name: "Assignee" });
  await assignee
    .getByRole("combobox", { name: "Assign to" })
    .selectOption({ label: staffName });
  await assignee.getByRole("button", { name: "Assign" }).click();
  await expect(assignee.getByRole("status")).toContainText(
    "The assignee is saved."
  );

  const notes = page.getByRole("region", { name: "Notes" });
  await notes
    .getByRole("textbox", { name: "Add a note" })
    .fill("Wrote back with the camp dates.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByRole("listitem")).toContainText(
    "Wrote back with the camp dates."
  );

  const status = page.getByRole("region", { name: "Status" });
  await status
    .getByRole("combobox", { name: "Why you're closing it" })
    .selectOption({ label: "Resolved" });
  await status.getByRole("button", { name: "Close message" }).click();
  await expect(status.getByRole("button", { name: "Reopen" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Details" })).toContainText(
    "Resolved"
  );
  await expectAccessible(page, "/admin/inbox/[id], closed");
  await expectAccessibleInDark(page, "/admin/inbox/[id], closed");
});
