import type { Instrumentation } from "next";
import { describe, expect, it, vi } from "vitest";

import type { SentryOptions } from "@/lib/observability/config";
import { hashUserId, silentErrorReporter } from "@/server/ports/errors";
import type { ErrorReporter } from "@/server/ports/errors";
import { FakeErrorReporter } from "@/test/fakes/errors";

import {
  requestErrorHandler,
  startErrorTracking,
  type ServerSentrySdk,
} from "./request-error";

type RequestInfo = Parameters<Instrumentation.onRequestError>[1];
type RequestContext = Parameters<Instrumentation.onRequestError>[2];

const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";

const request: RequestInfo = {
  path: "/blog/first-steps?email=asha@example.test",
  method: "GET",
  headers: {
    cookie: "session=abc123",
    authorization: "Bearer secret-token",
    "x-forwarded-for": "203.0.113.7",
  },
};

const renderContext: RequestContext = {
  routerKind: "App Router",
  routePath: "/blog/[slug]",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
};

describe("requestErrorHandler", () => {
  it("reports the error once, tagged with the route, without the query or any header", async () => {
    const reporter = new FakeErrorReporter();
    const onRequestError = requestErrorHandler(() => reporter);

    await onRequestError(new Error("Database is down"), request, renderContext);

    expect(reporter.reported).toHaveLength(1);
    const [reported] = reporter.reported;
    expect(reported).toMatchObject({
      type: "Error",
      message: "Database is down",
      tags: {
        where: "onRequestError",
        "route.path": "/blog/[slug]",
        "route.type": "render",
        "router.kind": "App Router",
        "http.method": "GET",
      },
      extra: { path: "/blog/first-steps" },
    });
    const sent = JSON.stringify(
      reporter.reported.map(({ error: _e, ...event }) => event)
    );
    for (const leaked of [
      "asha",
      "session=abc123",
      "secret-token",
      "203.0.113.7",
    ]) {
      expect(sent).not.toContain(leaked);
    }
  });

  it("tags each route type: a server action, a route handler, the proxy", async () => {
    const reporter = new FakeErrorReporter();
    const onRequestError = requestErrorHandler(() => reporter);

    for (const routeType of ["action", "route", "proxy"] as const) {
      await onRequestError(new Error(routeType), request, {
        ...renderContext,
        routeType,
      });
    }

    expect(reporter.reported.map((r) => r.tags["route.type"])).toEqual([
      "action",
      "route",
      "proxy",
    ]);
  });

  it("tags the digest the error page shows as its reference", async () => {
    const reporter = new FakeErrorReporter();
    const error = Object.assign(new Error("boom"), { digest: "2398765123" });

    await requestErrorHandler(() => reporter)(error, request, renderContext);

    expect(reporter.reported[0]?.tags.digest).toBe("2398765123");
  });

  it("waits until the event is sent, so a frozen function doesn't lose it", async () => {
    const calls: string[] = [];
    const reporter: ErrorReporter = {
      report: () => void calls.push("report"),
      flush: async () => {
        await Promise.resolve();
        calls.push("flushed");
        return true;
      },
    };

    await requestErrorHandler(async () => reporter)(
      new Error("boom"),
      request,
      renderContext
    );

    expect(calls).toEqual(["report", "flushed"]);
  });
});

/** Stands in for `@sentry/nextjs`, recording `init` and captures. */
function stubSdk() {
  const inits: SentryOptions[] = [];
  const captured: unknown[][] = [];
  const sdk: ServerSentrySdk = {
    init: (options) => void inits.push(options),
    captureException: (...args) => {
      captured.push(args);
      return "event-id";
    },
    flush: async () => true,
  };
  return { sdk, inits, captured };
}

describe("startErrorTracking", () => {
  it("without a DSN, reports nothing and never loads the SDK", async () => {
    const loadSdk = vi.fn(async () => stubSdk().sdk);

    for (const dsn of [undefined, "", "  "]) {
      const reporter = await startErrorTracking({
        dsn,
        appEnv: "production",
        loadSdk,
      });
      expect(reporter).toBe(silentErrorReporter);
    }
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("with a DSN, starts the SDK tagged with APP_ENV and scrubbing every event", async () => {
    const { sdk, inits } = stubSdk();

    await startErrorTracking({
      dsn: DSN,
      appEnv: "staging",
      release: "6f97d80",
      loadSdk: async () => sdk,
    });

    expect(inits).toHaveLength(1);
    const [options] = inits;
    expect(options).toMatchObject({
      dsn: DSN,
      environment: "staging",
      release: "6f97d80",
      sendDefaultPii: false,
    });
    const event = options?.beforeSend({
      message: "No account for asha@example.test",
      user: { id: "user-1", email: "asha@example.test" },
      request: { url: "/sign-in?email=asha@example.test", data: "email=asha" },
    });
    expect(event).toEqual({
      message: "No account for [email]",
      user: { id: hashUserId("user-1") },
      request: { url: "/sign-in" },
    });
  });

  it("with a DSN, reports through the SDK", async () => {
    const { sdk, captured } = stubSdk();
    const reporter = await startErrorTracking({
      dsn: DSN,
      appEnv: "staging",
      loadSdk: async () => sdk,
    });

    const error = new Error("boom");
    reporter.report(error, { where: "test" });

    expect(captured).toEqual([[error, { tags: { where: "test" } }]]);
  });

  it("keeps the server up, reporting nothing, when the SDK fails to load", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const reporter = await startErrorTracking({
      dsn: DSN,
      appEnv: "staging",
      loadSdk: () => Promise.reject(new Error("Cannot find module")),
    });

    expect(reporter).toBe(silentErrorReporter);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
