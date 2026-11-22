import { describe, expect, it } from "vitest";

import { SESSION_LIFETIME_DAYS } from "../../server/identity/settings";
import { invitationPath, SIGNED_IN_PREFIXES } from "../app-routes";
import { publicCsp, signedInCsp } from "../csp";
import { CSP_SOURCES, cspContext } from "../csp-sources";

import {
  ANALYTICS_EXCLUDED_PREFIXES,
  ANALYTICS_MARKER_TTL_MS,
  createAnalyticsGuard,
  isExcludedPath,
  scrubUrl,
  trackerScript,
  umamiConfig,
  umamiRewrites,
  type AnalyticsContext,
  type MarkerStorage,
} from "./umami";

const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";
const STAGING = {
  appEnv: "staging",
  appUrl: "https://shipped-it.dev",
  websiteId: WEBSITE_ID,
  origin: "https://stats.shipped-it.dev",
};
const DAY_MS = 24 * 60 * 60 * 1000;
/** A link token's shape (src/server/crypto/link-token.ts): 43 characters. */
const TOKEN = "A".repeat(43);

describe("umamiConfig", () => {
  it("turns analytics on for staging, on its own host only", () => {
    expect(umamiConfig(STAGING)).toEqual({
      websiteId: WEBSITE_ID,
      domains: ["shipped-it.dev"],
    });
  });

  it("pins production to the production host, whatever it is", () => {
    expect(
      umamiConfig({
        ...STAGING,
        appEnv: "production",
        appUrl: "https://www.friendsofanimals.example/",
      })?.domains
    ).toEqual(["www.friendsofanimals.example"]);
  });

  it.each([
    ["a local run", "local"],
    ["a preview", "preview"],
    ["an unset APP_ENV", undefined],
  ])("sends nothing from %s, even with a website id", (_, appEnv) => {
    expect(umamiConfig({ ...STAGING, appEnv })).toBeNull();
  });

  it("stays off until both the website id and the Umami origin are set", () => {
    expect(umamiConfig({ ...STAGING, websiteId: undefined })).toBeNull();
    expect(umamiConfig({ ...STAGING, websiteId: "" })).toBeNull();
    expect(umamiConfig({ ...STAGING, origin: undefined })).toBeNull();
    expect(umamiConfig({ ...STAGING, appUrl: undefined })).toBeNull();
  });

  it("refuses an APP_URL that is not a URL", () => {
    expect(() => umamiConfig({ ...STAGING, appUrl: "shipped-it.dev" })).toThrow(
      /APP_URL/
    );
  });
});

describe("umamiRewrites", () => {
  it("proxies only the tracker script and the collect endpoint", () => {
    expect(umamiRewrites("https://stats.shipped-it.dev/")).toEqual([
      {
        source: "/stats/script.js",
        destination: "https://stats.shipped-it.dev/script.js",
      },
      {
        source: "/stats/api/send",
        destination: "https://stats.shipped-it.dev/api/send",
      },
    ]);
  });

  it("adds nothing while UMAMI_ORIGIN is unset", () => {
    expect(umamiRewrites(undefined)).toEqual([]);
    expect(umamiRewrites("")).toEqual([]);
  });

  it.each([
    ["plain http", "http://stats.shipped-it.dev"],
    ["a path it would silently drop", "https://shipped-it.dev/umami"],
    ["not a URL", "stats.shipped-it.dev"],
  ])("refuses %s", (_, origin) => {
    expect(() => umamiRewrites(origin)).toThrow(/UMAMI_ORIGIN/);
  });
});

describe("trackerScript", () => {
  it("loads the proxied tracker, scoped, scrubbed and guarded", () => {
    const config = umamiConfig(STAGING);
    if (config === null) throw new Error("expected a config");
    expect(trackerScript(config)).toEqual({
      src: "/stats/script.js",
      dataset: {
        websiteId: WEBSITE_ID,
        domains: "shipped-it.dev",
        beforeSend: "foaBeforeSend",
        excludeSearch: "true",
        excludeHash: "true",
        doNotTrack: "true",
      },
    });
  });
});

describe("isExcludedPath", () => {
  const prefixes = ["/account", "/consent"];

  it("matches a prefix and everything under it", () => {
    expect(isExcludedPath("/account", prefixes)).toBe(true);
    expect(isExcludedPath("/account/", prefixes)).toBe(true);
    expect(isExcludedPath("/account/sessions", prefixes)).toBe(true);
    expect(isExcludedPath("/consent/abc123", prefixes)).toBe(true);
  });

  it("does not match a longer segment that merely starts the same", () => {
    expect(isExcludedPath("/accounts", prefixes)).toBe(false);
    expect(isExcludedPath("/consented-artwork", prefixes)).toBe(false);
    expect(isExcludedPath("/", prefixes)).toBe(false);
    expect(isExcludedPath("/competitions/kinder-skies", prefixes)).toBe(false);
  });

  it("keeps sign-in, sign-up and every token page out by default", () => {
    for (const path of [
      "/sign-in",
      "/sign-up",
      "/consent/tok",
      "/receipts/tok",
      "/donate/checkout/ord_1",
      // A coordinator invitation's link is its bearer credential (#74).
      invitationPath(TOKEN),
    ]) {
      expect(isExcludedPath(path, ANALYTICS_EXCLUDED_PREFIXES)).toBe(true);
    }
    expect(isExcludedPath("/donate", ANALYTICS_EXCLUDED_PREFIXES)).toBe(false);
  });
});

describe("scrubUrl", () => {
  it("drops the query and the fragment, absolute or relative", () => {
    expect(scrubUrl("https://shipped-it.dev/blog/x?email=a@b.test#top")).toBe(
      "https://shipped-it.dev/blog/x"
    );
    expect(scrubUrl("/blog/x?utm_source=y")).toBe("/blog/x");
    expect(scrubUrl("/about#team")).toBe("/about");
    expect(scrubUrl("")).toBe("");
  });
});

/** An in-memory localStorage, optionally broken the way Safari breaks it. */
function memoryStorage(broken: "read" | "write" | null = null) {
  const items = new Map<string, string>();
  const storage: MarkerStorage = {
    getItem(key) {
      if (broken === "read") throw new DOMException("denied", "SecurityError");
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      if (broken === "write") throw new DOMException("full", "QuotaExceeded");
      items.set(key, value);
    },
  };
  return { storage, items };
}

function context(overrides: Partial<AnalyticsContext> = {}) {
  const { storage, items } = memoryStorage();
  let now = Date.UTC(2026, 10, 21, 6, 0, 0);
  const ctx: AnalyticsContext = {
    signedInPrefixes: ["/account"],
    storage,
    now: () => now,
    doNotTrack: null,
    globalPrivacyControl: false,
    ...overrides,
  };
  return {
    ctx,
    items,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const pageview = (url: string, referrer = "") => ({
  website: WEBSITE_ID,
  hostname: "shipped-it.dev",
  url,
  referrer,
  title: "Friends of Animals",
});

describe("createAnalyticsGuard: whether the tracker loads at all", () => {
  it("loads on a public page for a visitor who never signed in", () => {
    const { ctx } = context();
    expect(createAnalyticsGuard(ctx).shouldLoad("/competitions")).toBe(true);
  });

  it("never loads on a signed-in page, and marks the browser there", () => {
    const { ctx } = context();
    const guard = createAnalyticsGuard(ctx);
    expect(guard.shouldLoad("/account/sessions")).toBe(false);
    // Later public pages in this browser send nothing either.
    expect(guard.shouldLoad("/competitions")).toBe(false);
    expect(createAnalyticsGuard(ctx).shouldLoad("/")).toBe(false);
  });

  it("never loads on sign-in, sign-up or token pages, without marking", () => {
    const { ctx, items } = context();
    const guard = createAnalyticsGuard(ctx);
    expect(guard.shouldLoad("/sign-in")).toBe(false);
    expect(guard.shouldLoad("/consent/tok")).toBe(false);
    expect(guard.shouldLoad(invitationPath(TOKEN))).toBe(false);
    expect(items.size).toBe(0);
    expect(guard.shouldLoad("/about")).toBe(true);
  });

  it("starts counting again 30 days after the last signed-in page", () => {
    const { ctx, advance } = context();
    const guard = createAnalyticsGuard(ctx);
    guard.shouldLoad("/account");
    advance(30 * DAY_MS - 1);
    expect(guard.shouldLoad("/about")).toBe(false);
    advance(1);
    expect(guard.shouldLoad("/about")).toBe(true);
  });

  it("each signed-in page pushes the 30 days out again", () => {
    const { ctx, advance } = context();
    const guard = createAnalyticsGuard(ctx);
    guard.shouldLoad("/account");
    advance(20 * DAY_MS);
    guard.shouldLoad("/account/sessions");
    advance(20 * DAY_MS);
    expect(guard.shouldLoad("/about")).toBe(false);
  });

  it("respects Do Not Track and Global Privacy Control", () => {
    expect(
      createAnalyticsGuard(context({ doNotTrack: "1" }).ctx).shouldLoad("/")
    ).toBe(false);
    expect(
      createAnalyticsGuard(
        context({ globalPrivacyControl: true }).ctx
      ).shouldLoad("/")
    ).toBe(false);
  });

  it("stays off when it can't read storage, so it can't tell who signed in", () => {
    const unreadable = context({ storage: memoryStorage("read").storage });
    expect(createAnalyticsGuard(unreadable.ctx).shouldLoad("/")).toBe(false);
    const missing = context({ storage: null });
    expect(createAnalyticsGuard(missing.ctx).shouldLoad("/")).toBe(false);
  });

  it("still refuses a signed-in page when storage is full", () => {
    const { ctx } = context({ storage: memoryStorage("write").storage });
    expect(createAnalyticsGuard(ctx).shouldLoad("/account")).toBe(false);
  });

  it("keeps the tab off for 30 days when storage refuses the mark", () => {
    const { ctx, advance } = context({
      storage: memoryStorage("write").storage,
    });
    const guard = createAnalyticsGuard(ctx);
    expect(guard.beforeSend("event", pageview("/account/sessions"))).toBe(
      false
    );
    expect(guard.beforeSend("event", pageview("/competitions"))).toBe(false);
    // Every guard in the tab shares its localStorage, and so the mark.
    expect(createAnalyticsGuard(ctx).shouldLoad("/competitions")).toBe(false);
    advance(30 * DAY_MS);
    expect(createAnalyticsGuard(ctx).shouldLoad("/competitions")).toBe(true);
  });

  it("keeps a signed-in browser marked at least as long as a session lasts", () => {
    expect(ANALYTICS_MARKER_TTL_MS).toBeGreaterThanOrEqual(
      SESSION_LIFETIME_DAYS * DAY_MS
    );
  });

  it("treats a stored value it doesn't understand as signed in", () => {
    const { ctx, items } = context();
    items.set("foa.analytics.off", "yes");
    expect(createAnalyticsGuard(ctx).shouldLoad("/")).toBe(false);
  });
});

describe("createAnalyticsGuard: every send the tracker makes", () => {
  it("sends a public page view with the query and fragment removed", () => {
    const { ctx } = context();
    const sent = createAnalyticsGuard(ctx).beforeSend(
      "event",
      pageview(
        "https://shipped-it.dev/blog/x?ref=mail#top",
        "https://news.example/a?id=7"
      )
    );
    expect(sent).toEqual(
      pageview("https://shipped-it.dev/blog/x", "https://news.example/a")
    );
  });

  it("cancels a page view of a signed-in page after client navigation", () => {
    const { ctx } = context();
    const guard = createAnalyticsGuard(ctx);
    expect(guard.beforeSend("event", pageview("/account/sessions"))).toBe(
      false
    );
    // ...and marks the browser, so the public page after it sends nothing.
    expect(guard.beforeSend("event", pageview("/competitions"))).toBe(false);
  });

  it("cancels sign-in, sign-up and token pages", () => {
    const { ctx } = context();
    const guard = createAnalyticsGuard(ctx);
    expect(guard.beforeSend("event", pageview("/sign-up"))).toBe(false);
    expect(
      guard.beforeSend("event", pageview("https://shipped-it.dev/receipts/t"))
    ).toBe(false);
    expect(
      guard.beforeSend(
        "event",
        pageview(`https://shipped-it.dev${invitationPath(TOKEN)}`)
      )
    ).toBe(false);
    expect(guard.beforeSend("event", pageview("/about"))).not.toBe(false);
  });

  // On client navigation Umami's tracker sends the page before as the
  // referrer, with the origin stripped when it is the site's own (3.5.0).
  it("never sends a page that sends nothing as the next page's referrer", () => {
    const guard = createAnalyticsGuard(context().ctx);
    expect(
      guard.beforeSend(
        "event",
        pageview("https://shipped-it.dev/receipts/SECRET-TOKEN")
      )
    ).toBe(false);
    for (const referrer of [
      "/receipts/SECRET-TOKEN",
      "https://shipped-it.dev/receipts/SECRET-TOKEN?x=1",
    ]) {
      expect(
        guard.beforeSend("event", pageview("https://shipped-it.dev/", referrer))
      ).toMatchObject({ referrer: "" });
    }
  });

  it("never sends a signed-in page as the referrer", () => {
    const guard = createAnalyticsGuard(context().ctx);
    for (const referrer of [
      "/account/sessions",
      "https://shipped-it.dev/account/sessions",
    ]) {
      expect(
        guard.beforeSend(
          "event",
          pageview("https://shipped-it.dev/about", referrer)
        )
      ).toMatchObject({ referrer: "" });
    }
  });

  it("never sends the site's own pages as referrers, listed or not", () => {
    const guard = createAnalyticsGuard(context().ctx);
    // A token page nobody has listed yet, and a plain public page.
    for (const referrer of [
      "/unlisted-links/SECRET-TOKEN",
      "https://shipped-it.dev/blog/x",
    ]) {
      expect(
        guard.beforeSend(
          "event",
          pageview("https://shipped-it.dev/about", referrer)
        )
      ).toMatchObject({ referrer: "" });
    }
    // A relative page url (umami.track({ url })) still names its host.
    expect(
      guard.beforeSend(
        "event",
        pageview(
          "/about",
          "https://shipped-it.dev/unlisted-links/SECRET-TOKEN"
        )
      )
    ).toMatchObject({ referrer: "" });
  });

  it("drops an outside referrer whose path never sends here", () => {
    for (const referrer of [
      "https://www.shipped-it.dev/receipts/SECRET-TOKEN",
      `https://www.shipped-it.dev${invitationPath(TOKEN)}`,
    ]) {
      expect(
        createAnalyticsGuard(context().ctx).beforeSend(
          "event",
          pageview("https://shipped-it.dev/", referrer)
        )
      ).toMatchObject({ referrer: "" });
    }
  });

  // What the tracker island passes (./tracker-island.ts): the real
  // signed-in prefixes, which don't cover the invitation page.
  it("keeps a coordinator invitation's link out with the site's own prefixes", () => {
    const guard = createAnalyticsGuard(
      context({ signedInPrefixes: SIGNED_IN_PREFIXES }).ctx
    );
    const link = `https://friendsofanimals.dev${invitationPath(TOKEN)}`;
    expect(guard.shouldLoad(invitationPath(TOKEN))).toBe(false);
    expect(guard.beforeSend("event", pageview(link))).toBe(false);
    expect(
      guard.beforeSend("event", pageview("https://friendsofanimals.dev/", link))
    ).toMatchObject({ referrer: "" });
  });

  it("cancels everything while the browser is marked", () => {
    const { ctx } = context();
    const guard = createAnalyticsGuard(ctx);
    guard.shouldLoad("/account");
    expect(guard.beforeSend("event", pageview("/about"))).toBe(false);
  });

  it("never sends an identify call", () => {
    const { ctx } = context();
    expect(
      createAnalyticsGuard(ctx).beforeSend("identify", pageview("/about"))
    ).toBe(false);
  });

  it("cancels a send whose url it can't read", () => {
    const { ctx } = context();
    const guard = createAnalyticsGuard(ctx);
    expect(guard.beforeSend("event", { website: WEBSITE_ID })).toBe(false);
    expect(guard.beforeSend("event", pageview("http://[bad"))).toBe(false);
  });
});

describe("analytics and the Content-Security-Policy", () => {
  /** The sources of `directive` in a serialised policy. */
  const sources = (policy: string, directive: string) =>
    policy
      .split("; ")
      .find((part) => part.startsWith(`${directive} `))
      ?.split(" ")
      .slice(1);

  // Quoted sources are keywords, nonces and hashes; anything else is a host.
  it.each(["staging", "production"])(
    "lets %s load scripts from the site's own origin only",
    (appEnv) => {
      const context = cspContext({ APP_ENV: appEnv, NODE_ENV: "production" });
      for (const policy of [
        publicCsp(context).value,
        signedInCsp(context, "bm9uY2U=").value,
      ]) {
        expect(
          sources(policy, "script-src")?.filter((s) => !s.startsWith("'"))
        ).toEqual([]);
      }
    }
  );

  it("adds no CSP source: the tracker and its endpoint are same-origin", () => {
    expect(
      CSP_SOURCES.filter((s) => /analytics|umami/i.test(s.feature))
    ).toEqual([]);
    const tag = trackerScript({ websiteId: WEBSITE_ID, domains: ["x.dev"] });
    expect(tag.src).toMatch(/^\/[^/]/);
    for (const rewrite of umamiRewrites(STAGING.origin)) {
      expect(rewrite.source).toMatch(/^\/stats\/[^/]/);
    }
  });
});
