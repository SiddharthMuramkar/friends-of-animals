import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { drainOutbox, freshEmail, readCode } from "./support/mailbox";

// #63: a member uploads a file on /account/files, waits for the virus
// check, and fetches the file back through a signed URL. Nothing here
// skips the check. In CI (`next start`, APP_ENV=local) the file goes to the
// app's local disk store and the local scanner checks it
// (src/server/deps.ts); the journey drains the outbox so the scan runs at
// once, with this build's handlers. Where a worker scans (staging), the
// drain is a 404 and the page waits for the worker.
//
// Each test signs up a fresh member rather than signing in a seeded one:
// the desktop and mobile projects run at once, and two sign-ins to one
// address could each read the other's code from the capture mailbox.

const PAGE = "/account/files";

/** The smallest valid PNG: 1×1 and transparent. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** One byte over the demo upload's 10 MB limit. */
const OVER_LIMIT = Buffer.alloc(10 * 1024 * 1024 + 1);

async function signUp(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Asha Rao");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);
}

test("a visitor is sent to sign in", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a member uploads a PNG and fetches it back once it passes the virus check", async ({
  page,
  request,
}, testInfo) => {
  // The page asks about the scan for up to a minute.
  test.setTimeout(120_000);
  await signUp(page, request, freshEmail(testInfo.project.name));

  await expectRendersAccessibly(page, PAGE);
  await expectAccessibleInDark(page, PAGE);

  await page
    .getByLabel("Choose a file")
    .setInputFiles({ name: "paw.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload" }).click();

  const status = page.getByRole("status");
  await expect(
    status.filter({ hasText: "Checking for viruses" })
  ).toBeVisible();
  await drainOutbox(request);
  await expect(status.filter({ hasText: "Ready" })).toBeVisible({
    timeout: 65_000,
  });
  await expectAccessibleInDark(page, `${PAGE} with a file ready`);

  // The link's route checks the session, then redirects to a signed URL;
  // page.request sends this browser's cookies and follows the redirect.
  const href = await page
    .getByRole("link", { name: "Download your file" })
    .getAttribute("href");
  expect(href).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("image/png");
  expect(Buffer.from(await download.body()).equals(PNG)).toBe(true);
});

test("a file over the limit is refused by the server, with the message shown", async ({
  page,
  request,
}, testInfo) => {
  await signUp(page, request, freshEmail(testInfo.project.name));
  await page.goto(PAGE);

  await page.getByLabel("Choose a file").setInputFiles({
    name: "too-big.png",
    mimeType: "image/png",
    buffer: OVER_LIMIT,
  });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "That file is too big. Files can be up to 10 MB." })
  ).toBeVisible();
});

test("the upload page fits a 320 px screen", async ({
  page,
  request,
}, testInfo) => {
  await signUp(page, request, freshEmail(testInfo.project.name));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(PAGE);
  await expect(page.getByLabel("Choose a file")).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "page width at 320 px").toBeLessThanOrEqual(clientWidth);
});
