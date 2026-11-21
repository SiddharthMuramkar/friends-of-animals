import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail } from "./support/mailbox";

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
