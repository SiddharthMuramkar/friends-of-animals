/** Independent public-media classifier: it must not import the gallery or
 * storage helpers under test. The one known static social card can use the
 * no-database build's local fallback origin; no other cross-origin URL can. */
export function classifyGalleryMedia(
  raw: string,
  origin: string
): "site" | "stamp" | "private" | "unknown" {
  let decoded = raw;
  try {
    for (let i = 0; i < 2 && /^%2[35f]/i.test(decoded); i++)
      decoded = decodeURIComponent(decoded);
  } catch {
    return "unknown";
  }
  // Encoded SVG filters are same-document references, not media URLs.
  if (/^#[a-z0-9_-]+$/i.test(decoded)) return "site";
  const url = new URL(decoded, origin);
  if (
    /(?:X-Amz-|signature=|presign)/i.test(url.href) ||
    /\/api\/files\/|\/entry_image\/|\/file_derivative\//.test(url.pathname)
  )
    return "private";
  if (url.origin !== origin) {
    if (
      new URL(origin).hostname === "localhost" &&
      url.origin === "http://localhost:3000" &&
      url.pathname === "/brand/foa-social-1200x630.png" &&
      !url.search
    )
      return "site";
    return "private";
  }
  if (url.pathname === "/_next/image")
    return classifyGalleryMedia(
      url.searchParams.get("url") ?? "/unknown",
      origin
    ) === "site"
      ? "site"
      : "private";
  if (
    /^\/media\/gallery\/[a-f0-9-]{36}$/i.test(url.pathname) &&
    (url.search === "" || url.search === "?size=thumb")
  )
    return "stamp";
  if (
    /^\/(?:_next\/static\/|brand\/|images\/|favicon\.ico$|apple-touch-icon)/.test(
      url.pathname
    )
  )
    return "site";
  return "unknown";
}
/** Parse candidates independently of descriptor width/density, keeping data
 * URI commas inside their URI rather than misclassifying inline bytes. */
export function srcsetUrls(srcset: string): string[] {
  const urls: string[] = [];
  let at = 0;
  while (at < srcset.length) {
    while (at < srcset.length && /[\s,]/.test(srcset[at]!)) at++;
    const start = at;
    const data = srcset.slice(at).startsWith("data:");
    while (
      at < srcset.length &&
      !(/\s/.test(srcset[at]!) || (!data && srcset[at] === ","))
    )
      at++;
    const url = srcset.slice(start, at);
    if (url && !data) urls.push(url);
    while (at < srcset.length && srcset[at] !== ",") at++;
    at++;
  }
  return urls;
}
