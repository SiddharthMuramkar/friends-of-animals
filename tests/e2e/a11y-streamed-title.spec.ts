import { expect, type Page } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_CONTACT_MESSAGE_IDS } from "../../src/server/seed/contact";
import { SEED_SCOPES } from "../../src/server/seed/scopes";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// The axe helper against the way Next 16.4 changes a page's <title> on a
// client-side navigation, server action redirect or refresh: every response
// mounts a new metadata boundary (keyed by its request id), so React drops
// the old <title> in the commit that shows the new page, and the new one
// streams in a commit or more later (#55's flake). These pages stand in for
// that moment, without a server. A full page load is different: the
// title comes in the <head> of the first HTML, request-time pages included.

/** A page whose content has changed and whose <title> is still to come. */
const PAGE_AFTER_A_NAVIGATION = `<!doctype html>
<html lang="en">
  <head><title>Old page · Friends of Animals</title></head>
  <body>
    <main><h1>Old page</h1></main>
    <script>
      document.querySelector("title").remove();
      document.querySelector("h1").textContent = "New page";
      // The new page's metadata, a moment after its content.
      setTimeout(() => {
        const title = document.createElement("title");
        title.textContent = "New page · Friends of Animals";
        document.head.append(title);
      }, 1000);
    </script>
  </body>
</html>`;

/** A page that never gets a <title>. */
const PAGE_WITHOUT_A_TITLE = `<!doctype html>
<html lang="en">
  <head></head>
  <body><main><h1>No title</h1></main></body>
</html>`;

test("axe checks a page once its streamed <title> has arrived", async ({
  page,
}) => {
  await page.setContent(PAGE_AFTER_A_NAVIGATION);
  await expect(page.getByRole("heading", { name: "New page" })).toBeVisible();

  await expectAccessible(page, "a page whose title streams in");
  await expect(page).toHaveTitle("New page · Friends of Animals");
});

test("a page without a <title> still fails the check", async ({ page }) => {
  await page.setContent(PAGE_WITHOUT_A_TITLE);

  await expect(expectAccessible(page, "an untitled page")).rejects.toThrow(
    "<title>"
  );
});

async function expectInitialTitle(page: Page, path: string, title: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBe(200);
  await expect(page).toHaveURL(path);

  const html = await response!.text();
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/)?.[1];
  expect(
    head?.match(/<title>([^<]*)<\/title>/)?.[1],
    `the initial <head> title of ${path}`
  ).toBe(title);
}

test("a signed-in page sends its <title> in the <head> of its HTML", async ({
  page,
  request,
}, testInfo) => {
  await signInByCode(
    page,
    request,
    freshEmail(testInfo.project.name),
    "Asha Rao"
  );

  await expectInitialTitle(
    page,
    "/account/sessions",
    "Your sessions · Friends of Animals"
  );
});

test("the competition editor and closed contact message send their titles in the initial HTML", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Leela Das",
    grants: [
      { role: "staff_admin", scope: { type: "global" } },
      { role: "competition_manager", scope: { type: "global" } },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/inbox");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=%2Fadmin%2Finbox$/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/admin/inbox");

  const competition = SEED_SCOPES.competition;
  const edit = `/admin/competitions/${competition.id}/edit`;
  await expectInitialTitle(page, edit, "Edit competition · Friends of Animals");
  await expect(
    page.getByRole("heading", { name: `Edit ${competition.name}` })
  ).toBeVisible();
  await expectAccessible(page, edit);

  const message = `/admin/inbox/${SEED_CONTACT_MESSAGE_IDS.resolved}`;
  await expectInitialTitle(
    page,
    message,
    "Contact message · Friends of Animals"
  );
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  await expectAccessible(page, message);
  await expectAccessibleInDark(page, message);
});
