import { describe, expect, it, vi } from "vitest";

import { startBrowserErrorTracking, type BrowserSentrySdk } from "./browser";

const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";

/** What the browser fires for an uncaught error. */
const errorEvent = (error: unknown) =>
  Object.assign(new Event("error"), { error });

/** What the browser fires for a rejection nobody handled. */
const rejectionEvent = (reason: unknown) =>
  Object.assign(new Event("unhandledrejection"), { reason });

/** Stands in for `@sentry/nextjs` in the browser. */
function stubSdk() {
  const captured: unknown[] = [];
  const init = vi.fn<BrowserSentrySdk["init"]>();
  const sdk: BrowserSentrySdk = {
    init,
    captureException: (error) => {
      captured.push(error);
      return "event-id";
    },
  };
  return { sdk, init, captured };
}

/** Lets pending imports and promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("startBrowserErrorTracking", () => {
  it("does nothing at all without a DSN", async () => {
    const target = new EventTarget();
    const loadSdk = vi.fn(async () => stubSdk().sdk);

    for (const dsn of [undefined, ""]) {
      startBrowserErrorTracking({ dsn, target, loadSdk });
    }
    target.dispatchEvent(errorEvent(new Error("boom")));
    await settle();

    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("loads nothing until the first error", async () => {
    const loadSdk = vi.fn(async () => stubSdk().sdk);

    startBrowserErrorTracking({ dsn: DSN, target: new EventTarget(), loadSdk });
    await settle();

    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("on the first error, loads the SDK once and reports every error seen while it loaded", async () => {
    const target = new EventTarget();
    const { sdk, captured } = stubSdk();
    const loadSdk = vi.fn(async () => sdk);
    startBrowserErrorTracking({ dsn: DSN, target, loadSdk });

    const first = new Error("first");
    const rejected = new TypeError("second");
    target.dispatchEvent(errorEvent(first));
    target.dispatchEvent(rejectionEvent(rejected));

    await vi.waitFor(() => expect(captured).toEqual([first, rejected]));
    expect(loadSdk).toHaveBeenCalledTimes(1);
  });

  it("starts the SDK through the tunnel, scrubbing, with no sessions or tracing", async () => {
    const target = new EventTarget();
    const { sdk, init } = stubSdk();
    startBrowserErrorTracking({ dsn: DSN, target, loadSdk: async () => sdk });

    target.dispatchEvent(errorEvent(new Error("boom")));

    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const options = init.mock.calls[0]![0];
    expect(options).toMatchObject({
      dsn: DSN,
      tunnel: "/monitoring",
      tracesSampleRate: 0,
      dataCollection: expect.objectContaining({
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
      }),
    });
    expect(
      options.beforeSend({ message: "Wrong code for asha@example.test" })
    ).toEqual({ message: "Wrong code for [email]" });
    const defaults = [
      "Breadcrumbs",
      "GlobalHandlers",
      "BrowserSession",
      "BrowserTracing",
      "Dedupe",
    ].map((name) => ({ name }));
    expect(options.integrations(defaults).map(({ name }) => name)).toEqual([
      "Breadcrumbs",
      "GlobalHandlers",
      "Dedupe",
    ]);
  });

  it("steps aside once the SDK has started, so its own handlers report later errors", async () => {
    const target = new EventTarget();
    const { sdk, captured } = stubSdk();
    const loadSdk = vi.fn(async () => sdk);
    startBrowserErrorTracking({ dsn: DSN, target, loadSdk });

    target.dispatchEvent(errorEvent(new Error("first")));
    await vi.waitFor(() => expect(captured).toHaveLength(1));
    target.dispatchEvent(errorEvent(new Error("later")));
    await settle();

    expect(loadSdk).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
  });

  it("gives up quietly, for good, when the SDK fails to load", async () => {
    const target = new EventTarget();
    const loadSdk = vi.fn(() => Promise.reject(new Error("chunk failed")));
    startBrowserErrorTracking({ dsn: DSN, target, loadSdk });

    target.dispatchEvent(errorEvent(new Error("first")));
    await vi.waitFor(() => expect(loadSdk).toHaveBeenCalledTimes(1));
    await settle();
    target.dispatchEvent(errorEvent(new Error("second")));
    await settle();

    expect(loadSdk).toHaveBeenCalledTimes(1);
  });
});
