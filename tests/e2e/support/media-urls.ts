// Classifies every media URL a public page references, for the crawl that
// proves no public gallery or results URL resolves to an original asset
// (#103, unit 103d).
//
// This file deliberately does not import the app's `PublicAssetUrl`: a
// check that reuses the code under test passes when both are wrong. It
// encodes the two rules on its own:
//   - Storage keys follow the Files layout `<prefix><purpose>/<fileId>`,
//     where the prefix is one environment folder (`pr-<n>/`, `br-<hash>/`,
//     `staging/`) or "" in production, and the file id is a UUID.
//   - Only `stamped_*` purposes are public. They are served from the CDN
//     (PUBLIC_ASSET_BASE_URL, any host, optionally under a base path) or,
//     with no CDN outside production, from the site's `/media/p/<key>`.
//
// Same-site paths are only read as storage keys under `/media/`, or when
// they carry an environment prefix, so a page such as `/verify/<id>` stays
// a page. Previews always have a prefix, which is where the crawl runs.
//
// Pure: no Playwright, so Vitest covers it (media-urls.test.ts).

/** Where on a page a URL was found. */
export type MediaSource =
  | "img-src"
  | "img-srcset"
  | "source-srcset"
  | "og:image"
  | "twitter:image"
  | "style-url"
  | "a-href";

export type MediaRef = { page: string; source: MediaSource; url: string };

/** A stamped copy, and the public root and environment prefix it sits under. */
export type StampedMedia = {
  kind: "stamped";
  via: "cdn" | "fallback";
  /** Origin plus base path, with no trailing slash. */
  root: string;
  /** "" or one folder with its trailing slash, as in a storage key. */
  prefix: string;
  purpose: string;
  fileId: string;
};

export type PrivateReason =
  | "files_api"
  | "signed_url"
  | "storage_api"
  | "original_key";

export type MediaClass =
  | { kind: "site" }
  | StampedMedia
  | { kind: "private"; why: PrivateReason }
  | { kind: "page" }
  | { kind: "external" }
  | { kind: "inline" }
  | { kind: "unknown" };

export type MediaContext = {
  /** The crawled origin first (relative URLs resolve against it), then any
   * other origin of this site, such as APP_URL's in absolute meta tags. */
  origins: readonly string[];
};

export type PublicRoots = { prefix: string; roots: string[] };

const FALLBACK_PATH = "/media/p";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ENV_PREFIX = "pr-[1-9][0-9]*|br-[0-9a-f]+|staging";
/** `<root>/<prefix>/<purpose>/<fileId>`, the root as short as it can be. */
const KEY_PATH = new RegExp(
  `^((?:/[^/]+)*?)/(?:(${ENV_PREFIX})/)?([a-z][a-z0-9_]*)/(${UUID})$`,
  "i"
);
const STAMPED_PURPOSE = /^stamped_[a-z0-9_]+$/;
const MEDIA_EXTENSION =
  /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;

const IMAGE_ALLOWED = new Set<MediaClass["kind"]>([
  "site",
  "stamped",
  "inline",
]);
const LINK_ALLOWED = new Set<MediaClass["kind"]>([
  ...IMAGE_ALLOWED,
  "page",
  "external",
]);

/** The URLs of a `srcset` attribute, descriptors dropped (HTML's parser). */
export function parseSrcset(srcset: string): string[] {
  const urls: string[] = [];
  const isSpace = (char: string) => /\s/.test(char);
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && (isSpace(srcset[i]!) || srcset[i] === ",")) i++;
    if (i >= srcset.length) break;
    const start = i;
    while (i < srcset.length && !isSpace(srcset[i]!)) i++;
    const url = srcset.slice(start, i);
    if (url.endsWith(",")) {
      urls.push(url.replace(/,+$/, ""));
      continue;
    }
    urls.push(url);
    // Skip the descriptors, up to a comma outside parentheses.
    let inParens = false;
    while (i < srcset.length) {
      const char = srcset[i++];
      if (inParens) inParens = char !== ")";
      else if (char === "(") inParens = true;
      else if (char === ",") break;
    }
  }
  return urls;
}

/** The `url(...)` references in an inline style. */
export function cssUrls(style: string): string[] {
  const urls: string[] = [];
  for (const match of style.matchAll(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi
  )) {
    const url = match[1] ?? match[2] ?? match[3] ?? "";
    if (url) urls.push(url);
  }
  return urls;
}

/** A storage key in the Files layout. */
export function storageKey(
  prefix: string,
  purpose: string,
  fileId: string
): string {
  return `${prefix}${purpose}/${fileId}`;
}

/** What a URL found on a public page points at. */
export function classifyMediaUrl(raw: string, ctx: MediaContext): MediaClass {
  return classify(
    raw,
    ctx.origins.map((origin) => new URL(origin).origin),
    true
  );
}

function classify(
  raw: string,
  origins: readonly string[],
  unwrap: boolean
): MediaClass {
  let url: URL;
  try {
    url = new URL(raw.trim(), origins[0]);
  } catch {
    return { kind: "unknown" };
  }
  if (url.protocol === "data:") return { kind: "inline" };
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "external" };
  }
  if (
    [...url.searchParams.keys()].some((name) =>
      name.toLowerCase().startsWith("x-amz-")
    )
  ) {
    return { kind: "private", why: "signed_url" };
  }
  if (url.hostname.endsWith(".r2.cloudflarestorage.com")) {
    return { kind: "private", why: "storage_api" };
  }

  const path = url.pathname;
  const key = parseKeyPath(path);
  if (!origins.includes(url.origin)) {
    if (key) return keyMedia(key, url.origin, "cdn");
    return MEDIA_EXTENSION.test(path)
      ? { kind: "unknown" }
      : { kind: "external" };
  }

  if (path === "/_next/image") {
    // next/image: judge the image it wraps (one level deep).
    const inner = url.searchParams.get("url");
    return inner && unwrap
      ? classify(inner, origins, false)
      : { kind: "unknown" };
  }
  if (
    path.startsWith("/_next/static/") ||
    path.startsWith("/brand/") ||
    path === "/favicon.ico"
  ) {
    return { kind: "site" };
  }
  if (path === "/api/files" || path.startsWith("/api/files/")) {
    return { kind: "private", why: "files_api" };
  }
  if (path.startsWith("/media/")) {
    if (!key) return { kind: "unknown" };
    if (!STAMPED_PURPOSE.test(key.purpose)) {
      return { kind: "private", why: "original_key" };
    }
    return key.root === FALLBACK_PATH
      ? keyMedia(key, url.origin, "fallback")
      : { kind: "unknown" };
  }
  if (key && key.prefix !== "") {
    // A key with an environment prefix on some other site route: only the
    // fallback route may serve one.
    return STAMPED_PURPOSE.test(key.purpose)
      ? { kind: "unknown" }
      : { kind: "private", why: "original_key" };
  }
  return MEDIA_EXTENSION.test(path) ? { kind: "unknown" } : { kind: "page" };
}

type KeyPath = {
  root: string;
  prefix: string;
  purpose: string;
  fileId: string;
};

function parseKeyPath(path: string): KeyPath | null {
  const match = KEY_PATH.exec(path);
  if (!match) return null;
  const [, root = "", prefix, purpose = "", fileId = ""] = match;
  return { root, prefix: prefix ? `${prefix}/` : "", purpose, fileId };
}

function keyMedia(
  key: KeyPath,
  origin: string,
  via: StampedMedia["via"]
): MediaClass {
  if (!STAMPED_PURPOSE.test(key.purpose)) {
    return { kind: "private", why: "original_key" };
  }
  return {
    kind: "stamped",
    via,
    root: `${origin}${key.root}`,
    prefix: key.prefix,
    purpose: key.purpose,
    fileId: key.fileId,
  };
}

/**
 * Classifies every reference. Images may only be site assets, stamped
 * copies or inline data; links may also lead to pages and other sites.
 */
export function auditMediaRefs(
  refs: readonly MediaRef[],
  ctx: MediaContext
): {
  stamped: (MediaRef & { media: StampedMedia })[];
  violations: (MediaRef & { media: MediaClass })[];
} {
  const stamped: (MediaRef & { media: StampedMedia })[] = [];
  const violations: (MediaRef & { media: MediaClass })[] = [];
  for (const ref of refs) {
    const media = classifyMediaUrl(ref.url, ctx);
    const allowed = ref.source === "a-href" ? LINK_ALLOWED : IMAGE_ALLOWED;
    if (!allowed.has(media.kind)) violations.push({ ...ref, media });
    else if (media.kind === "stamped") stamped.push({ ...ref, media });
  }
  return { stamped, violations };
}

/**
 * Where an original would be if it had leaked into the public bucket or
 * the fallback route: every CDN root the crawl saw, plus the crawled
 * site's own `/media/p`, under the one environment prefix every stamped
 * URL shares. Fails an empty crawl and a mixed prefix.
 */
export function publicRoots(
  stamped: readonly StampedMedia[],
  crawlOrigin: string
): PublicRoots {
  const first = stamped[0];
  if (!first) {
    throw new Error(
      "The crawl found no stamped image, so nothing shows the gallery serves stamped copies."
    );
  }
  const other = stamped.find((media) => media.prefix !== first.prefix);
  if (other) {
    throw new Error(
      `Stamped URLs disagree on the storage prefix: ${JSON.stringify(first.prefix)} and ${JSON.stringify(other.prefix)}.`
    );
  }
  const cdnRoots = stamped
    .filter((media) => media.via === "cdn")
    .map((media) => media.root);
  const fallback = `${new URL(crawlOrigin).origin}${FALLBACK_PATH}`;
  return { prefix: first.prefix, roots: [...new Set([...cdnRoots, fallback])] };
}

/** The URLs that must answer 4xx for an original or private derivative. */
export function originalProbeUrls(
  { prefix, roots }: PublicRoots,
  original: { purpose: string; fileId: string }
): string[] {
  if (STAMPED_PURPOSE.test(original.purpose)) {
    throw new Error(
      `${original.purpose} is a public purpose; probe originals and private derivatives only.`
    );
  }
  const key = storageKey(prefix, original.purpose, original.fileId);
  return roots.map((root) => `${root}/${key}`);
}
