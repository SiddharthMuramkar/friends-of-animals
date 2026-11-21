import { expect, test } from "@playwright/test";

import { recordCspViolations } from "./support/csp";

// #118: a preview sends no analytics. Only staging and production builds
// with Umami configured render the tracker island, and only they proxy
// /stats/. Across the smoke routes a preview loads no tracker, makes no
// /stats/ request, sets no cookie and hits no CSP violation.

// Vercel's toolbar isn't part of the site (see the #65 spec).
test.use({ extraHTTPHeaders: { "x-vercel-skip-toolbar": "1" } });

const ROUTES = [
  "/",
  "/donate",
  "/safeguarding",
  "/competitions",
  "/blog",
  "/sign-in",
  "/sign-up",
];

test("a preview loads no tracker, sends no page view and sets no cookie", async ({
  page,
  context,
}) => {
  const violations = await recordCspViolations(page);
  // The Vercel bypass cookie from global setup, if any, is already here.
  const cookiesBefore = (await context.cookies()).map(({ name }) => name);
  const analytics: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/stats/") || /umami/i.test(url.host)) {
      analytics.push(request.url());
    }
  });

  for (const path of ROUTES) {
    const response = await page.goto(path, { waitUntil: "load" });
    expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
    expect(await response?.text(), `${path}'s HTML`).not.toContain(
      "/stats/script.js"
    );
    await expect(page.locator('script[src^="/stats/"]')).toHaveCount(0);
    expect(
      await page.evaluate(() => "foaBeforeSend" in window),
      `the send guard on ${path}`
    ).toBe(false);
  }

  expect(analytics).toEqual([]);
  expect((await context.cookies()).map(({ name }) => name)).toEqual(
    cookiesBefore
  );
  expect(violations).toEqual([]);
});

test("a preview doesn't proxy Umami", async ({ request }) => {
  for (const path of ["/stats/script.js", "/stats/api/send"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `HTTP status of ${path}`).toBe(404);
  }
});
