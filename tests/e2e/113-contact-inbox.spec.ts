import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail, readCode } from "./support/mailbox";

// #113: the public contact form on the prerendered /contact page, in its
// empty, error and success states. The island solves a real proof-of-work
// challenge (16 bits) in the browser. The acknowledgement email is proved
// at Seam 1 (a preview's worker may lag M5's tip, HR-10), so this only
// checks what the sender sees. Each run uses a fresh address, so the
// per-address limit never trips; previews allow 100 per IP an hour, since
// every run comes from the CI runner's one address.

const REFERENCE = /CM-\d{2}-[0-9A-HJKMNP-TV-Z]{6}/;

/** The seeded staff admin (seed/access.ts), who sees every team's messages. */
const STAFF_ADMIN = { email: "member2@example.test", name: "Ravi Kumar" };

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

/** Sends a General message through the form; returns its reference. */
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
  await form
    .getByRole("textbox", { name: "Your message" })
    .fill("How can I help at the next adoption camp?");
  await form.getByRole("button", { name: "Send message" }).click();
  const done = page.getByRole("status").filter({ hasText: "Your reference" });
  await expect(done).toContainText(REFERENCE, { timeout: 30_000 });
  return (await done.textContent())!.match(REFERENCE)![0];
}

test("a staff admin assigns, notes and closes a message in the inbox", async ({
  page,
  request,
}, testInfo) => {
  // A message of this test's own, so the shared seed data stays as it is.
  const subject = `Helping at camp (${testInfo.project.name})`;
  const reference = await sendMessage(page, testInfo, subject);

  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill(STAFF_ADMIN.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, STAFF_ADMIN.email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);

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
    .selectOption({ label: STAFF_ADMIN.name });
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
