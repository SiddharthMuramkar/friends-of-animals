import { expect, test, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { SEED_TEMPLATE_EDITORS } from "../../src/server/seed/accounts";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import {
  drainOutbox,
  freshEmail,
  readCode,
  readEmail,
} from "./support/mailbox";

// #69: a member reads their in-app inbox, the header counts what is unread
// in words, and they choose email or SMS; a content manager opens the
// message templates. The new member's welcome is drained on the preview
// itself (POST /api/preview/drain), running this PR's dispatcher. The
// template pages are only viewed, so shared seed data stays as it is.
// Staff pages need the second step (#60): the content manager enters the
// seed authenticator's code (the preview-only SEED_TOTP_SECRET) on #60's
// second-step page first. Each project signs in its own seeded template
// editor, so no other journey shares its one-use codes.

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

/**
 * Enters the seed authenticator's code on #60's second-step page, which
 * then sends the browser to `next`. A code works once per authenticator,
 * and a run moments before may have used this window's, so a refused code
 * is followed by the next window's, which one step of drift allows.
 * A refusal is the form's alert in <main>: Next's route announcer, outside
 * it, is an alert on every page.
 */
async function enterSecondStep(page: Page, next: string) {
  const secret = base32Decode(SEED_TOTP_SECRET);
  await page.goto(`/auth/second-factor?next=${encodeURIComponent(next)}`);
  for (const stepsAhead of [0, 1]) {
    await page
      .getByRole("textbox", { name: "6-digit code" })
      .fill(totpCode(secret, new Date(Date.now() + stepsAhead * 30_000)));
    await page.getByRole("button", { name: "Continue" }).click();
    const outcome = await Promise.race([
      page
        .waitForURL((url) => url.pathname === next)
        .then(
          () => "passed" as const,
          () => "waiting" as const
        ),
      page
        .getByRole("main")
        .getByRole("alert")
        .waitFor()
        .then(
          () => "refused" as const,
          () => "waiting" as const
        ),
    ]);
    if (outcome === "passed") return;
  }
  await expect(page).toHaveURL((url) => url.pathname === next);
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
  // Another test's drain may hold this welcome a moment after ours returns.
  // The dispatcher sends its email just before it writes the inbox item.
  await readEmail(request, email, "Welcome to Friends of Animals");
  const welcome = page.getByRole("heading", {
    name: "Welcome to Friends of Animals",
  });
  await expect
    .poll(
      async () => {
        await page.goto("/account/inbox");
        // The list streams in after the page's heading.
        await page.getByRole("heading", { name: "Messages" }).waitFor();
        return welcome.isVisible();
      },
      { message: "the welcome message in the inbox" }
    )
    .toBe(true);

  await expectRendersAccessibly(page, "/account/inbox");
  await expectAccessibleInDark(page, "/account/inbox");
  const badge = page.getByRole("banner").getByRole("link", { name: /^Inbox/ });
  await expect(badge).toHaveAccessibleName("Inbox: 1 unread message");
  await expect(badge).toContainText("1 unread");
  // The header still fits a 320 px screen with text at 200% (WCAG 1.4.10):
  // the page never scrolls sideways.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(badge).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(320);
  if (viewport) await page.setViewportSize(viewport);
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("font-size");
  });
  await expect(welcome).toBeVisible();

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
}, testInfo) => {
  const { email } =
    testInfo.project.name === "mobile"
      ? SEED_TEMPLATE_EDITORS.mobile
      : SEED_TEMPLATE_EDITORS.desktop;
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await enterCode(page, request, email, "Sign in");
  await enterSecondStep(page, "/admin/templates");

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
