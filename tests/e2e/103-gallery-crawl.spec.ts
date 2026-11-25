import { expect, test } from "@playwright/test";
import { SEED_GALLERY } from "../../src/server/seed/gallery-samples";

import {
  classifyGalleryMedia as classify,
  srcsetUrls,
} from "./support/gallery-media-urls";

test("crawl public gallery and result pages; only same-origin stamped gallery copies can serve art", async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const pending = ["/gallery", "/competitions"],
    seen = new Set<string>(),
    stamps = new Set<string>(),
    results = new Set<string>();
  const images = new Set<string>();
  let auditSurface = true;
  page.on("request", (r) => {
    if (auditSurface && r.resourceType() === "image") images.add(r.url());
  });
  while (pending.length) {
    const path = pending.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    // The competition index is a discovery-only index; its static wildlife
    // photos and external attribution pages aren't gallery/result media.
    auditSurface = path !== "/competitions";
    const response = await page.goto(path);
    expect(response?.status(), path).toBeLessThan(400);
    // Wait for streamed live links before collecting the gallery or released results.
    if (path === "/gallery")
      await expect(
        page.getByRole("link", { name: "View A refuge for birds" })
      ).toBeVisible();
    if (path.startsWith("/gallery/") && !path.includes("/report"))
      await expect(page.locator('img[src^="/media/gallery/"]')).toBeVisible();
    if (path === "/competitions")
      await expect(
        page.getByRole("link", { name: /Art for kindness/ }).first()
      ).toBeVisible();
    if (path.endsWith("/results"))
      await expect(
        page.getByRole("link", { name: "About this competition" })
      ).toBeVisible();
    if (path === "/competitions/art-for-kindness/results")
      await expect(page.getByText("Asha Rao", { exact: true })).toBeVisible();
    const refs = await page.evaluate(() => {
      const sources = Array.from(
        document.querySelectorAll(
          "img[src],img[srcset],source[srcset],meta[property='og:image'],meta[name='twitter:image']"
        )
      )
        .flatMap((el) => [el.getAttribute("src"), el.getAttribute("content")])
        .filter((v): v is string => !!v && !v.startsWith("data:"));
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href]")
      ).map((a) => a.getAttribute("href")!);
      const styles = Array.from(
        document.querySelectorAll<HTMLElement>("[style]")
      )
        .flatMap((el) =>
          Array.from(
            (el.getAttribute("style") ?? "").matchAll(
              /url\(['"]?([^'")]+)['"]?\)/g
            )
          ).map((m) => m[1]!)
        )
        .filter((s) => !s.startsWith("data:"));
      return {
        sources: [
          ...sources,
          ...styles,
          ...links.filter((l) =>
            /\.(?:jpe?g|webp|png|svg|gif|avif)(?:\?|$)|\/media\/|\/api\/files\/|X-Amz-/i.test(
              l
            )
          ),
        ],
        links,
        srcsets: Array.from(document.querySelectorAll("[srcset]")).map(
          (el) => el.getAttribute("srcset") ?? ""
        ),
      };
    });
    for (const src of auditSurface
      ? [...refs.sources, ...refs.srcsets.flatMap(srcsetUrls)]
      : []) {
      const c = classify(src, origin);
      expect(["site", "stamp"], `${path}: ${src}`).toContain(c);
      if (c === "stamp") {
        const url = new URL(src, origin);
        stamps.add(url.pathname + url.search);
      }
    }
    for (const href of refs.links) {
      const link = new URL(href, origin);
      if (link.origin !== origin) continue;
      const h = link.pathname + link.search;
      if (/^\/gallery(?:\?|$)|^\/gallery\/[a-f0-9-]{36}$/i.test(h))
        pending.push(h);
      if (/^\/competitions\/[^/]+\/results$/.test(link.pathname)) {
        pending.push(h);
        results.add(h);
      }
      if (
        path === "/competitions" &&
        /^\/competitions\/[^/]+$/.test(link.pathname)
      ) {
        const result = link.pathname + "/results";
        results.add(result);
        pending.push(result);
      }
    }
  }
  expect(results.size).toBeGreaterThan(0);
  expect(stamps.size).toBeGreaterThanOrEqual(6);
  expect([...stamps].some((path) => path.endsWith("?size=thumb"))).toBe(true);
  for (const media of images) {
    const c = classify(media, origin);
    expect(["site", "stamp"], media).toContain(c);
  }
  for (const path of stamps) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["content-type"]).toBe("image/webp");
    expect((await response.body()).subarray(8, 12).toString()).toBe("WEBP");
  }
  for (const id of SEED_GALLERY.originalFileIds) {
    for (const path of [
      `/media/gallery/${id}`,
      `/media/p/entry_image/${id}`,
      `/media/p/local/entry_image/${id}`,
      `/api/files/${id}`,
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBeGreaterThanOrEqual(300);
      expect(response.headers()["content-type"] ?? "").not.toMatch(/^image\//);
    }
  }
});
