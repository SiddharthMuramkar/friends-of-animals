import { type APIRequestContext, expect, type Page } from "@playwright/test";

import { instantToIstLocal } from "../../src/server/modules/competitions/domain/ist";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { type SeedAccount, test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #112: the admin blog. A content manager starts a post, saves it as a
// draft, reads it in the editor's preview, schedules it, then publishes it
// at once. Every page is checked with axe, light and dark. 112b owns the
// public /blog pages.
//
// Each test seeds its own content manager and authenticator, so the
// desktop and mobile projects never share a one-use code with each other
// or with #111's CMS journey. Each run writes a post at an address of its
// own, so it can run again on the same data.

const DENIED = "Only content managers can open this page";

/** The page's notice after an action redirected back to the editor. */
function notice(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

/**
 * Text on the page as shown. Next keeps the page navigated away from in
 * the document, hidden, for going back, and getByText would find it too.
 */
function shownText(page: Page, text: string) {
  return page.getByText(text).filter({ visible: true });
}

/**
 * A content manager of this test's own, signed in and past the staff
 * gate's second factor on the blog list.
 */
async function signInAsContentManager(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Blog Content Manager",
    grants: [{ role: "content_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/blog");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=%2Fadmin%2Fblog$/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/blog$/);
}

test("a content manager drafts a post, previews it, schedules it and publishes it", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  const run = `${testInfo.project.name}-${Date.now().toString(36)}`;
  const title = `Water bowls for summer (${run})`;
  const sentence = `Put out a shallow bowl of clean water every morning (${run}).`;

  await signInAsContentManager(page, request, seedAccount);
  await expectAccessible(page, "/admin/blog");
  await expectAccessibleInDark(page, "/admin/blog");

  await page.getByRole("link", { name: "New post", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/blog\/new$/);
  await expectAccessible(page, "/admin/blog/new");
  await expectAccessibleInDark(page, "/admin/blog/new");

  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page
    .getByRole("textbox", { name: "Web address" })
    .fill(`water-bowls-${run}`);
  await page
    .getByRole("textbox", { name: "Summary" })
    .fill("How a bowl of water on a step helps birds and street dogs.");
  // The run's mark makes the title too long for a browser tab.
  await page
    .getByRole("textbox", { name: "Search title" })
    .fill("Water bowls for summer");
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill(`## Why it helps\n\n${sentence}\n`);
  await page.getByRole("button", { name: "Save draft" }).click();

  // The editor: the saved draft, its preview and the photo consent rule.
  await expect(page).toHaveURL(/\/admin\/blog\/[0-9a-f-]{36}\?notice=created-/);
  await expect(notice(page, "Draft saved.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(shownText(page, "Status: Draft.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Preview", exact: true })
  ).toContainText(sentence);
  const images = page.getByRole("region", { name: "Images", exact: true });
  await expect(images).toContainText("Photos of children");
  await expect(images).toContainText(
    "only if a parent or guardian has agreed in writing"
  );
  await expectAccessible(page, "/admin/blog/[id]");
  await expectAccessibleInDark(page, "/admin/blog/[id]");

  // Schedule it for tomorrow, India time.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await page
    .getByLabel("Go live at (India time)")
    .fill(instantToIstLocal(tomorrow));
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(notice(page, "Scheduled.")).toBeVisible();
  await expect(shownText(page, "Status: Scheduled.")).toBeVisible();
  await expectAccessible(page, "/admin/blog/[id] scheduled");

  // Then put it live now instead.
  await page.getByRole("button", { name: "Publish now", exact: true }).click();
  await expect(notice(page, "Published. The blog shows it now.")).toBeVisible();
  await expect(shownText(page, "Status: Published.")).toBeVisible();
  await expectAccessible(page, "/admin/blog/[id] published");
  await expectAccessibleInDark(page, "/admin/blog/[id] published");

  await page.getByRole("link", { name: "All posts" }).click();
  await expect(page).toHaveURL(/\/admin\/blog$/);
  await expect(page.getByRole("row", { name: new RegExp(run) })).toContainText(
    "Published"
  );
});

test("a member without the role is refused on the blog pages", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "Ishaan Mehta", grants: [] });
  await signInByCode(page, request, email);

  // Holding no staff role, the staff gate lets him through; the pages
  // refuse him and show no editor.
  for (const path of ["/admin/blog", "/admin/blog/new"]) {
    await expectRendersAccessibly(page, path);
    await expect(page.getByRole("heading", { name: DENIED })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true })
    ).toHaveCount(0);
  }
});
