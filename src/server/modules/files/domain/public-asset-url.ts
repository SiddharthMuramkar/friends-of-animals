// URLs for files anyone may see. Only stamped copies (purposes `stamped_*`:
// resized, logo-stamped, metadata stripped) live in the public bucket;
// originals and private derivatives never get a public URL. A
// `PublicAssetUrl` can only be made by `publicAssetUrl()`, which refuses
// every other purpose, so a public read model whose image fields are typed
// `PublicAssetUrl` cannot carry an original's key.
//
// Where the URL points:
//   - `cdn`: PUBLIC_ASSET_BASE_URL, the public bucket's CDN host. Required in
//     production; until it exists production fails closed.
//   - `fallback`: outside production, with no CDN configured, the app's own
//     route `/media/p/<key>` streams stamped files (and nothing else).
//
// Keys follow the Files module's layout, `<prefix><purpose>/<fileId>`, where
// the prefix is "" or one lower-case folder (`pr-12/`, `staging/`, ...).
//
// Pure: loads under plain Node, so no `@/` imports.

declare const publicAssetUrlBrand: unique symbol;

/** A URL built by `publicAssetUrl()` for a stamped file. */
export type PublicAssetUrl = string & { readonly [publicAssetUrlBrand]: true };

export type PublicAssetBase =
  | { kind: "cdn"; origin: string }
  | { kind: "fallback" };

type AppEnv = "local" | "preview" | "staging" | "production";

/** The app route that serves stamped files when no CDN is configured. */
export const PUBLIC_ASSET_FALLBACK_PATH = "/media/p";

const PUBLIC_PURPOSE = /^stamped_[a-z0-9_]+$/;
const STAMPED_KEY =
  /^(?:[a-z0-9-]+\/)?(stamped_[a-z0-9_]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Thrown when PUBLIC_ASSET_BASE_URL is missing in production or malformed. */
export class PublicAssetBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicAssetBaseError";
  }
}

/** Thrown when code asks for a public URL to a file that isn't public. */
export class NotPublicAssetError extends Error {
  constructor(file: { purpose: string; storageKey: string }) {
    // The key is safe to name: keys hold only prefix, purpose and file id.
    super(
      `Not a public asset: purpose ${JSON.stringify(file.purpose)}, key ${JSON.stringify(file.storageKey)}`
    );
    this.name = "NotPublicAssetError";
  }
}

/** Whether files of this purpose may be served publicly. */
export function isPublicAssetPurpose(purpose: string): boolean {
  return PUBLIC_PURPOSE.test(purpose);
}

/**
 * Where public URLs point in this environment. `configured` is
 * PUBLIC_ASSET_BASE_URL: an https origin, optionally with a path, and no
 * credentials, query or fragment (plain http only for a local CDN).
 */
export function publicAssetBase({
  appEnv,
  configured,
}: {
  appEnv: AppEnv;
  configured: string | undefined;
}): PublicAssetBase {
  if (configured === undefined || configured === "") {
    if (appEnv === "production") {
      throw new PublicAssetBaseError(
        "PUBLIC_ASSET_BASE_URL is required in production: public images are served only from the CDN there."
      );
    }
    return { kind: "fallback" };
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new PublicAssetBaseError("PUBLIC_ASSET_BASE_URL is not a URL.");
  }
  const localHttp =
    url.protocol === "http:" &&
    appEnv === "local" &&
    LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new PublicAssetBaseError("PUBLIC_ASSET_BASE_URL must use https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PublicAssetBaseError(
      "PUBLIC_ASSET_BASE_URL must have no credentials, query or fragment."
    );
  }
  const path = url.pathname.replace(/\/+$/, "");
  return { kind: "cdn", origin: `${url.origin}${path}` };
}

function isStampedKey(storageKey: string, purpose?: string): boolean {
  const match = STAMPED_KEY.exec(storageKey);
  return match !== null && (purpose === undefined || match[1] === purpose);
}

function rootOf(base: PublicAssetBase): string {
  return base.kind === "cdn" ? base.origin : PUBLIC_ASSET_FALLBACK_PATH;
}

/**
 * The public URL of a stamped file. Throws `NotPublicAssetError` for any
 * other purpose, or a key that isn't a stamped key of that purpose.
 */
export function publicAssetUrl(
  base: PublicAssetBase,
  file: { purpose: string; storageKey: string }
): PublicAssetUrl {
  if (
    !isPublicAssetPurpose(file.purpose) ||
    !isStampedKey(file.storageKey, file.purpose)
  ) {
    throw new NotPublicAssetError(file);
  }
  const path = file.storageKey.split("/").map(encodeURIComponent).join("/");
  return `${rootOf(base)}/${path}` as PublicAssetUrl;
}

/** The stamped key a public URL points at, or null if it isn't one. */
export function storageKeyFromPublicAssetUrl(
  base: PublicAssetBase,
  url: string
): string | null {
  const root = `${rootOf(base)}/`;
  if (!url.startsWith(root)) return null;
  let key: string;
  try {
    key = url.slice(root.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  return isStampedKey(key) ? key : null;
}

/**
 * The storage key the fallback route `/media/p/[...key]` was asked for, or
 * null (answer 404) unless the segments form a stamped key.
 */
export function storageKeyFromFallbackPath(
  segments: readonly string[]
): string | null {
  if (segments.some((segment) => segment.includes("/"))) return null;
  const key = segments.join("/");
  return isStampedKey(key) ? key : null;
}
