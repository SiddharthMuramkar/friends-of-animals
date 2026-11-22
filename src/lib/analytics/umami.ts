/**
 * Cookieless page views through a self-hosted Umami, decided in one place:
 *
 * - Only staging and production send anything, each to its own Umami
 *   website and only from its own host. Previews and local runs send
 *   nothing.
 * - The tracker script and its collect endpoint are proxied under
 *   /stats/ on the site's own origin, so the CSP stays 'self'.
 * - Signed-in pages, sign-in and sign-up, and pages with a token in the
 *   path never load the tracker or send anything. A browser that has shown
 *   a signed-in page is marked for 30 days, so its later public pages send
 *   nothing either: public pages are prerendered and can't know who is
 *   signed in.
 * - Query strings and fragments never leave the browser, and neither do
 *   the site's own pages as referrers.
 *
 * Keep this file free of Next.js, `@/` and server-only imports (relative
 * imports of plain modules only): next.config.ts loads it under plain Node,
 * and a client island runs it.
 */

import { INVITATIONS_PREFIX, isUnderPrefix } from "../app-routes";
import { ROUTES } from "../routes";

/** Where the site serves Umami's tracker script (proxied, see below). */
const SCRIPT_PATH = "/stats/script.js";

/** The global the tracker calls before each send (`data-before-send`). */
export const BEFORE_SEND_GLOBAL = "foaBeforeSend";

/** localStorage key holding when the signed-in mark runs out (ms). */
export const ANALYTICS_MARKER_KEY = "foa.analytics.off";

/** How long a signed-in page keeps a browser out of analytics. */
export const ANALYTICS_MARKER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Public pages that still never send: signing in or up (children
 * register here), and pages whose path carries a token. Signed-in prefixes
 * come from the route registry and are added by the caller.
 */
export const ANALYTICS_EXCLUDED_PREFIXES = [
  ROUTES.signIn.path,
  ROUTES.signUp.path,
  "/consent",
  "/receipts",
  "/donate/checkout",
  INVITATIONS_PREFIX,
] as const;

/** The deployment settings analytics depends on, read at build time. */
export type UmamiEnv = {
  appEnv: string | undefined;
  /** Canonical base URL (APP_URL); its host is the only one that sends. */
  appUrl: string | undefined;
  /** NEXT_PUBLIC_UMAMI_WEBSITE_ID: one Umami website per deployment. */
  websiteId: string | undefined;
  /** UMAMI_ORIGIN, e.g. https://stats.shipped-it.dev. */
  origin: string | undefined;
};

export type UmamiConfig = {
  websiteId: string;
  /** Host names the tracker may run on (`data-domains`). */
  domains: readonly string[];
};

/**
 * Whether this deployment sends page views, and as which website. Null
 * outside staging and production, and until both the website id and the
 * Umami origin are set.
 */
export function umamiConfig(env: UmamiEnv): UmamiConfig | null {
  if (env.appEnv !== "staging" && env.appEnv !== "production") return null;
  if (!env.websiteId || !env.origin || !env.appUrl) return null;
  let host: string;
  try {
    host = new URL(env.appUrl).hostname;
  } catch {
    throw new RangeError(
      `APP_URL must be an absolute URL, not ${JSON.stringify(env.appUrl)}`
    );
  }
  return { websiteId: env.websiteId, domains: [host] };
}

export type UmamiRewrite = { source: string; destination: string };

/**
 * Whether `value` can be UMAMI_ORIGIN: an https origin with no path, query
 * or fragment (a trailing slash is fine). The rewrites below would drop a
 * path silently.
 */
export function isUmamiOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

/**
 * next.config.ts rewrites: the tracker script and the collect endpoint
 * only. A /stats/:path* wildcard would put Umami's dashboard and API on
 * the site's origin. None while UMAMI_ORIGIN is unset.
 */
export function umamiRewrites(origin: string | undefined): UmamiRewrite[] {
  if (!origin) return [];
  if (!isUmamiOrigin(origin)) {
    throw new RangeError(
      "UMAMI_ORIGIN must be an https origin with no path, e.g. " +
        `https://stats.shipped-it.dev, not ${JSON.stringify(origin)}`
    );
  }
  const base = new URL(origin).origin;
  return [
    { source: SCRIPT_PATH, destination: `${base}/script.js` },
    { source: "/stats/api/send", destination: `${base}/api/send` },
  ];
}

/**
 * The tracker's <script>: its src, and the data-* attributes as a DOM
 * dataset (camelCase). The tracker posts to the directory it was loaded
 * from, i.e. /stats/api/send.
 */
export function trackerScript(config: UmamiConfig): {
  src: string;
  dataset: Record<string, string>;
} {
  return {
    src: SCRIPT_PATH,
    dataset: {
      websiteId: config.websiteId,
      domains: config.domains.join(","),
      beforeSend: BEFORE_SEND_GLOBAL,
      excludeSearch: "true",
      excludeHash: "true",
      doNotTrack: "true",
    },
  };
}

/**
 * True when `pathname` is one of `prefixes` or below one, by whole
 * segments: the route registry's matcher, which the proxy uses too.
 */
export const isExcludedPath = isUnderPrefix;

/** `url` without its query string and fragment. */
export function scrubUrl(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? "";
}

/** The part of localStorage the guard uses. */
export type MarkerStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type AnalyticsContext = {
  /** Path prefixes behind sign-in (SIGNED_IN_PREFIXES). */
  signedInPrefixes: readonly string[];
  /** window.localStorage, or null where the browser has none. */
  storage: MarkerStorage | null;
  now: () => number;
  /** navigator.doNotTrack */
  doNotTrack?: string | null | undefined;
  /** navigator.globalPrivacyControl */
  globalPrivacyControl?: boolean | undefined;
};

/** What the tracker hands `data-before-send` (website, title, ...). */
type Payload = {
  url?: unknown;
  referrer?: unknown;
  hostname?: unknown;
  [field: string]: unknown;
};

/**
 * Marks that localStorage refused to store (full or blocked), by storage
 * object, so the tab stays off anyway: every guard in a tab gets the same
 * window.localStorage. Each lasts until the mark would have run out, or
 * until the page reloads.
 */
const unsavedMarks = new WeakMap<MarkerStorage, number>();

export type AnalyticsGuard = {
  /** Whether to load the tracker on a page first opened at `pathname`. */
  shouldLoad: (pathname: string) => boolean;
  /**
   * The `data-before-send` handler: the payload to send, scrubbed, or
   * false to cancel. It runs for every page view, including client-side
   * navigation, so it repeats the page checks.
   */
  beforeSend: <T extends Payload>(type: string, payload: T) => T | false;
};

/**
 * The rules for one browser. Showing a signed-in page marks the browser;
 * while marked, or when the mark can't be read, nothing loads or sends.
 */
export function createAnalyticsGuard(ctx: AnalyticsContext): AnalyticsGuard {
  const excluded = [...ctx.signedInPrefixes, ...ANALYTICS_EXCLUDED_PREFIXES];

  /** Marks the browser on a signed-in page; true if the page may send. */
  function admitPage(pathname: string): boolean {
    if (isExcludedPath(pathname, ctx.signedInPrefixes)) {
      mark();
      return false;
    }
    return !isExcludedPath(pathname, excluded) && !isMarked();
  }

  function mark() {
    if (ctx.storage === null) return;
    const until = ctx.now() + ANALYTICS_MARKER_TTL_MS;
    try {
      ctx.storage.setItem(ANALYTICS_MARKER_KEY, String(until));
    } catch {
      // Storage full or blocked: keep the mark for this tab instead.
      unsavedMarks.set(ctx.storage, until);
    }
  }

  /** Unreadable storage counts as marked: it can't rule a sign-in out. */
  function isMarked(): boolean {
    if (ctx.storage === null) return true;
    if (ctx.now() < (unsavedMarks.get(ctx.storage) ?? 0)) return true;
    let value: string | null;
    try {
      value = ctx.storage.getItem(ANALYTICS_MARKER_KEY);
    } catch {
      return true;
    }
    if (value === null) return false;
    const until = Number(value);
    return !Number.isFinite(until) || ctx.now() < until;
  }

  function optedOut(): boolean {
    return ctx.doNotTrack === "1" || ctx.globalPrivacyControl === true;
  }

  /**
   * The referrer to send with a page view of `page`: another site's page,
   * without its query and fragment, or nothing. The site's own pages never
   * go out as referrers. On client navigation Umami's tracker passes the
   * page before (its origin stripped), which may be a token or signed-in
   * page that sends nothing itself, listed here or not yet.
   */
  function outsideReferrer(
    referrer: unknown,
    page: URL,
    hostname: unknown
  ): string {
    if (typeof referrer !== "string") return "";
    let from: URL;
    try {
      from = new URL(referrer, page);
    } catch {
      return "";
    }
    const own = from.hostname === page.hostname || from.hostname === hostname;
    if (own || isExcludedPath(from.pathname, excluded)) return "";
    return scrubUrl(referrer);
  }

  return {
    shouldLoad(pathname) {
      return admitPage(pathname) && !optedOut();
    },
    beforeSend(type, payload) {
      if (type !== "event" || typeof payload.url !== "string") return false;
      let page: URL;
      try {
        page = new URL(payload.url, "https://origin.invalid");
      } catch {
        return false;
      }
      if (!admitPage(page.pathname) || optedOut()) return false;
      return {
        ...payload,
        url: scrubUrl(payload.url),
        ...(payload.referrer !== undefined && {
          referrer: outsideReferrer(payload.referrer, page, payload.hostname),
        }),
      };
    },
  };
}
