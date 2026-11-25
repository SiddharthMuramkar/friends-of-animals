import { expect, test } from "@playwright/test";
import { SEED_GALLERY } from "../../src/server/seed/gallery";

/** Deliberately independent from the gallery projection or storage helper.
 * Recognise only the site's own concrete media routes and bundled assets. */
function classify(
  raw: string,
  origin: string
): "site" | "stamp" | "private" | "unknown" {
  const url = new URL(raw, origin);
  if (
    url.origin !== origin ||
    /(?:X-Amz-|signature=|presign)/i.test(url.href) ||
    /\/api\/files\/|\/entry_image\/|\/file_derivative\//.test(url.pathname)
  )
    return "private";
  if (url.pathname === "/_next/image")
    return classify(url.searchParams.get("url") ?? "/unknown", origin) ===
      "site"
      ? "site"
      : "private";
  if (/^\/media\/gallery\/[a-f0-9-]{36}$/i.test(url.pathname) && !url.search)
    return "stamp";
  if (
    /^\/(?:_next\/static\/|brand\/|images\/|favicon\.ico$|apple-touch-icon)/.test(
      url.pathname
    )
  )
    return "site";
  return "unknown";
}
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
  page.on("request", (r) => {
    if (r.resourceType() === "image") images.add(r.url());
  });
  while (pending.length) {
    const path = pending.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
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
    const refs = await page.evaluate(() => {
      const sources = Array.from(
        document.querySelectorAll(
          "img[src],img[srcset],source[srcset],meta[property='og:image'],meta[name='twitter:image']"
        )
      )
        .flatMap((el) => [
          el.getAttribute("src"),
          el.getAttribute("content"),
          ...(el.getAttribute("srcset") ?? "")
            .split(",")
            .map((src) => src.trim().split(/\s+/)[0]),
        ])
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
              /url\(['"]?([^'"\)]+)['"]?\)/g
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
      };
    });
    for (const src of refs.sources) {
      const c = classify(src, origin);
      expect(["site", "stamp"], `${path}: ${src}`).toContain(c);
      if (c === "stamp") stamps.add(new URL(src, origin).pathname);
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
      )
        pending.push(h);
    }
  }
  expect(results.size).toBeGreaterThan(0);
  expect(stamps.size).toBeGreaterThanOrEqual(2);
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
