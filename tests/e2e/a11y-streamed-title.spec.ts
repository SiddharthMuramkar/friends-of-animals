import { expect, test } from "@playwright/test";

import { expectAccessible } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
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

  // A request-time page under the nonce policy (#65), as staff pages are.
  const html = await (await page.request.get("/account/sessions")).text();
  const headEnd = html.indexOf("</head>");
  expect(headEnd, "the end of the <head>").toBeGreaterThan(0);
  expect(html.slice(0, headEnd)).toContain(
    "<title>Your sessions · Friends of Animals</title>"
  );
});
