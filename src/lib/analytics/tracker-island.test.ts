import { describe, expect, it } from "vitest";

import { startAnalytics, type AnalyticsWindow } from "./tracker-island";
import {
  ANALYTICS_MARKER_KEY,
  ANALYTICS_MARKER_TTL_MS,
  BEFORE_SEND_GLOBAL,
  type UmamiConfig,
} from "./umami";

const CONFIG: UmamiConfig = {
  websiteId: "94db1cb1-74f4-4a40-ad6c-962362670409",
  domains: ["shipped-it.dev"],
};
const NOW = Date.UTC(2026, 10, 21, 9, 30);

type FakeOptions = {
  pathname?: string;
  stored?: Record<string, string>;
  /** Reading window.localStorage throws, as with storage blocked. */
  blockedStorage?: boolean;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
};

/**
 * A browser window with only what the island reads, plus a document whose
 * cookie access is recorded: analytics must never touch it.
 */
function fakeWindow(options: FakeOptions = {}) {
  const stored = new Map(Object.entries(options.stored ?? {}));
  const cookieAccess: string[] = [];
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  };
  const win: AnalyticsWindow & { document: { cookie: string } } = {
    location: { pathname: options.pathname ?? "/" },
    get localStorage() {
      if (options.blockedStorage) {
        throw new Error("SecurityError: The operation is insecure.");
      }
      return storage;
    },
    navigator: {
      doNotTrack: options.doNotTrack ?? null,
      ...(options.globalPrivacyControl !== undefined && {
        globalPrivacyControl: options.globalPrivacyControl,
      }),
    },
    document: {
      get cookie() {
        cookieAccess.push("read");
        return "";
      },
      set cookie(_value: string) {
        cookieAccess.push("write");
      },
    },
  };
  return { win, stored, cookieAccess };
}

const start = (win: AnalyticsWindow) => startAnalytics(win, CONFIG, NOW);

describe("startAnalytics on a public page", () => {
  it("returns the tracker tag to inject and installs the send guard", () => {
    const { win } = fakeWindow({ pathname: "/awareness" });

    expect(start(win)).toEqual({
      src: "/stats/script.js",
      dataset: expect.objectContaining({
        websiteId: CONFIG.websiteId,
        domains: "shipped-it.dev",
        beforeSend: BEFORE_SEND_GLOBAL,
      }),
    });
    expect(win[BEFORE_SEND_GLOBAL]).toBeTypeOf("function");
  });

  it("injects the tracker once, however often the page effect runs", () => {
    const { win } = fakeWindow({ pathname: "/" });

    expect(start(win)).not.toBeNull();
    expect(start(win)).toBeNull();
    win.location.pathname = "/awareness";
    expect(start(win)).toBeNull();
  });

  it("scrubs and cancels sends through the installed guard", () => {
    const { win, stored } = fakeWindow({ pathname: "/" });
    start(win);
    const beforeSend = win[BEFORE_SEND_GLOBAL];

    expect(
      beforeSend?.("event", { url: "/blog/hello?ref=mail#top", website: "w" })
    ).toEqual({ url: "/blog/hello", website: "w" });
    expect(beforeSend?.("event", { url: "/account/sessions" })).toBe(false);
    expect(stored.get(ANALYTICS_MARKER_KEY)).toBeDefined();
  });

  it("loads nothing while the browser is marked from a signed-in page", () => {
    const { win } = fakeWindow({
      pathname: "/",
      stored: { [ANALYTICS_MARKER_KEY]: String(NOW + 1000) },
    });

    expect(start(win)).toBeNull();
    expect(win[BEFORE_SEND_GLOBAL]).toBeUndefined();
  });

  it("loads again once the mark has run out", () => {
    const { win } = fakeWindow({
      pathname: "/",
      stored: { [ANALYTICS_MARKER_KEY]: String(NOW - 1) },
    });

    expect(start(win)).not.toBeNull();
  });

  it.each([
    ["Do Not Track", { doNotTrack: "1" }],
    ["Global Privacy Control", { globalPrivacyControl: true }],
    ["blocked storage", { blockedStorage: true }],
  ])("loads nothing with %s", (_, options: FakeOptions) => {
    const { win } = fakeWindow({ pathname: "/", ...options });

    expect(start(win)).toBeNull();
    expect(win[BEFORE_SEND_GLOBAL]).toBeUndefined();
  });
});

describe("startAnalytics on a signed-in page", () => {
  it("never injects the tracker and marks the browser for 30 days", () => {
    const { win, stored } = fakeWindow({ pathname: "/account/sessions" });

    expect(start(win)).toBeNull();
    expect(win[BEFORE_SEND_GLOBAL]).toBeUndefined();
    expect(stored.get(ANALYTICS_MARKER_KEY)).toBe(
      String(NOW + ANALYTICS_MARKER_TTL_MS)
    );
  });

  it("marks the browser on a client navigation there, tracker or not", () => {
    // Opened on sign-in (excluded, not signed in yet), then signed in.
    const { win, stored } = fakeWindow({ pathname: "/sign-in" });
    expect(start(win)).toBeNull();
    expect(stored.has(ANALYTICS_MARKER_KEY)).toBe(false);

    win.location.pathname = "/account/sessions";
    expect(start(win)).toBeNull();
    expect(stored.has(ANALYTICS_MARKER_KEY)).toBe(true);

    win.location.pathname = "/awareness";
    expect(start(win)).toBeNull();
  });

  it("lets a visitor who left sign-in without signing in be counted", () => {
    const { win } = fakeWindow({ pathname: "/sign-up" });
    expect(start(win)).toBeNull();

    win.location.pathname = "/";
    expect(start(win)).not.toBeNull();
  });
});

describe("startAnalytics and cookies", () => {
  it("never reads or writes document.cookie", () => {
    for (const pathname of ["/", "/account/sessions", "/sign-in"]) {
      const { win, cookieAccess } = fakeWindow({ pathname });
      start(win);
      win[BEFORE_SEND_GLOBAL]?.("event", { url: pathname });

      expect(cookieAccess).toEqual([]);
    }
  });
});
