import { expect, test, type Page } from "@playwright/test";

import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { drainOutbox, freshEmail, readCode } from "./support/mailbox";

// #69: a member reads their in-app inbox, the header counts what is unread
// in words, and they choose email or SMS; a content manager opens the
// message templates. The new member's welcome is drained on the preview
// itself (POST /api/preview/drain), running this PR's dispatcher. The
// template pages are only viewed, so shared seed data stays as it is.

/** The seeded member who holds the content manager role (seed/access.ts). */
const CONTENT_MANAGER = "member1@example.test";

async function enterCode(
  page: Page,
  request: Parameters<typeof readCode>[0],
  email: string,
  button: "Create account" | "Sign in"
) {
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
}

test("a new member reads their inbox, and the unread count drops", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await enterCode(page, request, email, "Create account");
  await drainOutbox(request);

  await expectRendersAccessibly(page, "/account/inbox");
  await expectAccessibleInDark(page, "/account/inbox");
  const badge = page.getByRole("banner").getByRole("link", { name: /^Inbox/ });
  await expect(badge).toHaveAccessibleName("Inbox: 1 unread message");
  await expect(badge).toContainText("1 unread");
  await expect(
    page.getByRole("heading", { name: "Welcome to Friends of Animals" })
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: "Mark “Welcome to Friends of Animals” as read",
    })
    .click();
  await expect(badge).toHaveAccessibleName("Inbox, no unread messages");
  await expect(page.getByText("You have no unread messages.")).toBeVisible();

  await expectRendersAccessibly(page, "/account/notifications");
  await expectAccessibleInDark(page, "/account/notifications");
  await page.getByRole("checkbox", { name: "SMS" }).uncheck();
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your choices are saved."
  );
  await expect(page.getByRole("checkbox", { name: "SMS" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Email" })).toBeChecked();
});

test("a content manager opens the message templates", async ({
  page,
  request,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill(CONTENT_MANAGER);
  await enterCode(page, request, CONTENT_MANAGER, "Sign in");

  await expectRendersAccessibly(page, "/admin/templates");
  await expectAccessibleInDark(page, "/admin/templates");
  await page.getByRole("link", { name: "Edit Welcome" }).click();
  await expect(page).toHaveURL(/\/admin\/templates\/identity\.welcome$/);

  await expectRendersAccessibly(page, "/admin/templates/identity.welcome");
  await expectAccessibleInDark(page, "/admin/templates/identity.welcome");
  await expect(page.getByRole("textbox", { name: "Subject" })).toHaveValue(
    "Welcome to Friends of Animals"
  );
  await expect(page.getByText("Hello Asha Rao,")).toBeVisible();
});
