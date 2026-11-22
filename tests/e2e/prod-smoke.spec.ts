import { expect, test } from "@playwright/test";

import { ROUTES } from "../../src/lib/routes";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { onlyPolicy } from "./support/csp";

// Production smoke (LAUNCH §18.4): what a live production deployment must
// show, checked at every deploy. Read-only: it only GETs public URLs, never
// signs in, and creates no data. Sample competitions are off in production,
// so nothing here assumes competition cards. Only the `prod-smoke` project
// runs this file (.github/workflows/e2e.yml).

/** Production's canonical host; www.<apex> must redirect to it. */
const PRODUCTION_APEX = "friendsofanimals.dev";

/** Every public page in src/lib/routes.ts that production serves. */
const PUBLIC_PAGES = Object.values(ROUTES)
  .filter((route) => !route.path.includes("[") && !("nonProduction" in route))
  .map((route) => route.path);

/** Cookie names of common analytics tools. The site sets none of them. */
const ANALYTICS_COOKIE =
  /^(_ga|_gid|_gat|_gcl|_fbp|_hj|_pk_|_clck|_clsk|mp_|ajs_|amplitude|plausible|umami)|analytics/i;

for (const path of PUBLIC_PAGES) {
  test(`${path} answers 200 and is accessible in light and dark`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status(), `HTTP status of ${path}`).toBe(200);
    await expectAccessible(page, path);
    await expectAccessibleInDark(page, path);
  });
}

test("/api/health answers 200 with status ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok" });
});

test("robots.txt allows indexing and links the sitemap", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).not.toMatch(/noindex/i);
  expect(body).toMatch(/^Sitemap:\s*https?:\/\/\S+\/sitemap\.xml\s*$/im);
});

test("pages carry no noindex header", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-robots-tag"] ?? "").not.toMatch(/noindex/i);
});

test("sitemap.xml answers 200", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("<urlset");
});

test("pages carry a Content-Security-Policy (report-only allowed)", async ({
  page,
}) => {
  const policy = await onlyPolicy(await page.goto("/"), "/");
  expect(policy).toMatch(/default-src/);
});

test("no analytics cookie is set", async ({ page, context }) => {
  for (const path of ["/", "/competitions", "/donate"]) {
    await page.goto(path);
  }
  const analytics = (await context.cookies())
    .map(({ name }) => name)
    .filter((name) => ANALYTICS_COOKIE.test(name));
  expect(analytics, "analytics cookies").toEqual([]);
});

test("an unknown path renders the 404 page with status 404", async ({
  page,
}) => {
  const response = await page.goto("/prod-smoke-no-such-page");
  expect(response?.status()).toBe(404);
  // The title from messages/en-IN/notFound.json.
  await expect(page).toHaveTitle(/Page not found/);
  await expectAccessible(page, "the 404 page");
});

test("www redirects to the apex with a 308", async ({ request, baseURL }) => {
  const { hostname } = new URL(baseURL!);
  // Only production has the www host; any other base URL has nothing to check.
  const expectsWwwRedirect = hostname === PRODUCTION_APEX;
  test.info().annotations.push({
    type: "www → apex",
    description: expectsWwwRedirect
      ? `checked on www.${PRODUCTION_APEX}`
      : `not applicable: ${hostname} is not ${PRODUCTION_APEX}`,
  });
  if (!expectsWwwRedirect) return;

  const response = await request.get(`https://www.${PRODUCTION_APEX}/`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe(`https://${PRODUCTION_APEX}/`);
});
