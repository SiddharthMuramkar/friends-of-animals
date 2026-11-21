import { expect, type Page, test } from "@playwright/test";

import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";

// The public blog reads posts from the CMS (#112): /blog and a post render
// with no axe violations in both themes, no URL on them reaches an original
// upload, and a slug that isn't a public post is a real 404.

/** Every URL the page loads or links to: src, srcset and href. */
async function urlsOn(page: Page): Promise<URL[]> {
  const raw = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("[src], [srcset], [href]")) {
      const src = el.getAttribute("src");
      const href = el.getAttribute("href");
      const srcset = el.getAttribute("srcset");
      if (src) out.push(src);
      if (href) out.push(href);
      if (srcset) {
        for (const part of srcset.split(",")) {
          const url = part.trim().split(/\s+/)[0];
          if (url) out.push(url);
        }
      }
    }
    return out;
  });
  return raw.map((u) => new URL(u, page.url()));
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// An uploaded post image's original lives at <prefix>cms_image/<fileId> in
// the private bucket; its public copies at
// <prefix>public/cms_image/<fileId>/post_cover_1200 or post_inline_960.
const UPLOAD = new RegExp(`(?:^|/)(public/)?cms_image/${UUID}(/[^/?#]*)?`);
const DERIVATIVE = /^\/post_(?:cover_1200|inline_960)(?:\.[a-z]+)?$/;

/** Whether a URL could serve an original upload instead of a public copy. */
function reachesOriginal(url: URL): boolean {
  // R2's S3 API host serves the private bucket; the public one has its own.
  if (url.hostname.endsWith(".r2.cloudflarestorage.com")) return true;
  const path = decodeURIComponent(url.pathname + url.search);
  const match = UPLOAD.exec(path);
  if (!match) return false;
  const [, publicPrefix, rest] = match;
  return !publicPrefix || !rest || !DERIVATIVE.test(rest);
}

async function expectNoOriginals(page: Page) {
  const originals = (await urlsOn(page)).filter(reachesOriginal);
  expect(
    originals.map((u) => u.href),
    `URLs on ${page.url()} that reach an original upload`
  ).toEqual([]);
}

test("/blog and a post render accessibly and link no original upload", async ({
  page,
}) => {
  await expectRendersAccessibly(page, "/blog");
  await expectAccessibleInDark(page, "/blog");
  await expectNoOriginals(page);

  const href = await page
    .locator('main a[href^="/blog/"]')
    .first()
    .getAttribute("href");
  expect(href, "a post linked from /blog").toBeTruthy();

  await expectRendersAccessibly(page, href!);
  await expectAccessibleInDark(page, href!);
  await expectNoOriginals(page);
});

test("a post carries BlogPosting structured data", async ({ page }) => {
  await page.goto("/blog");
  const href = await page
    .locator('main a[href^="/blog/"]')
    .first()
    .getAttribute("href");
  await page.goto(href!);
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  const types = blocks.flatMap((text) => {
    const data: unknown = JSON.parse(text);
    return (Array.isArray(data) ? data : [data]).map(
      (d: { "@type"?: string }) => d["@type"]
    );
  });
  expect(types).toContain("BlogPosting");
  expect(types).toContain("BreadcrumbList");
});

test("a slug that isn't a public post answers 404", async ({ page }) => {
  const response = await page.goto("/blog/no-such-post-here");
  expect(response?.status()).toBe(404);
});
