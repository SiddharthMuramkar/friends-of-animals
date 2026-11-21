import { describe, expect, it } from "vitest";

import { errorTracking, parseDsn, sentryOptions } from "./config";

const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";

describe("parseDsn", () => {
  it("reads the key, host and project of a Sentry DSN", () => {
    expect(parseDsn(DSN)).toEqual({
      protocol: "https",
      publicKey: "abc123",
      host: "o1.ingest.us.sentry.io",
      path: "",
      projectId: "4507",
    });
    expect(parseDsn("http://k@localhost:9000/sentry/7")).toEqual({
      protocol: "http",
      publicKey: "k",
      host: "localhost:9000",
      path: "/sentry",
      projectId: "7",
    });
  });

  it("refuses anything that is not a DSN", () => {
    for (const value of [
      "",
      "not a url",
      "https://o1.ingest.sentry.io/4507",
      "https://abc@o1.ingest.sentry.io/",
      "https://abc@o1.ingest.sentry.io/project",
      "ftp://abc@o1.ingest.sentry.io/4507",
    ]) {
      expect(parseDsn(value)).toBeUndefined();
    }
  });
});

describe("errorTracking", () => {
  it("is off without a DSN, so local runs, CI and builds need no secret", () => {
    expect(errorTracking({ appEnv: "staging" })).toEqual({ enabled: false });
    expect(errorTracking({ dsn: "", appEnv: "production" })).toEqual({
      enabled: false,
    });
    expect(errorTracking({ dsn: "  " })).toEqual({ enabled: false });
  });

  it("tags events with APP_ENV, local when unset", () => {
    expect(errorTracking({ dsn: DSN, appEnv: "staging" })).toEqual({
      enabled: true,
      dsn: DSN,
      environment: "staging",
    });
    expect(errorTracking({ dsn: DSN })).toMatchObject({
      environment: "local",
    });
    expect(
      errorTracking({ dsn: DSN, appEnv: "production", release: "6f97d80" })
    ).toEqual({
      enabled: true,
      dsn: DSN,
      environment: "production",
      release: "6f97d80",
    });
  });

  it("fails loudly on a malformed DSN without printing it", () => {
    expect(() => errorTracking({ dsn: "https://secret-ish/1" })).toThrow(
      /not a valid Sentry DSN/
    );
    expect(() => errorTracking({ dsn: "https://secret-ish/1" })).not.toThrow(
      /secret-ish/
    );
  });
});

describe("sentryOptions", () => {
  const tracking = {
    enabled: true as const,
    dsn: DSN,
    environment: "staging",
  };

  it("collects no personal data and sends no traces, whatever the environment says", () => {
    const options = sentryOptions(tracking);
    expect(options).toMatchObject({
      dsn: DSN,
      environment: "staging",
      // Sentry 11 collects all of this by default; sendDefaultPii is gone.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        databaseQueryData: false,
        queues: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        mcp: { inputs: false, outputs: false },
      },
    });
    // A sampler, not tracesSampleRate: 0. Sentry asks the sampler before it
    // follows a caller's `sentry-trace ...-1`, and before
    // SENTRY_TRACES_SAMPLE_RATE, so no span is ever sampled.
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options.tracesSampler({ parentSampled: true })).toBe(0);
    expect(options).not.toHaveProperty("sendDefaultPii");
    expect(options).not.toHaveProperty("beforeSendTransaction");
    expect(options).not.toHaveProperty("release");
  });

  it("scrubs any span that is sent anyway: its name, URL and query parts", () => {
    const span = sentryOptions(tracking).beforeSendSpan({
      name: "GET /sign-in?email=asha@example.test",
      attributes: {
        "http.method": "GET",
        "http.target": "/sign-in?email=asha@example.test",
        "url.full": "https://shipped-it.dev/sign-in?code=482913",
        "url.query": "email=asha@example.test",
        "http.query": "code=482913",
        "user.email": "asha@example.test",
      },
    });

    expect(span).toEqual({
      name: "GET /sign-in",
      attributes: {
        "http.method": "GET",
        "http.target": "/sign-in",
        "url.full": "https://shipped-it.dev/sign-in",
        "user.email": "[email]",
      },
    });
  });

  it("scrubs every event and breadcrumb before it is sent", () => {
    const options = sentryOptions(tracking, {
      hashUserId: () => "u_0123456789abcdef",
    });
    expect(
      options.beforeSend({
        message: "to asha@example.test",
        user: { id: "1", email: "asha@example.test" },
      })
    ).toEqual({ message: "to [email]", user: { id: "u_0123456789abcdef" } });
    expect(
      options.beforeBreadcrumb({ category: "console", message: "9876543210" })
    ).toEqual({ category: "console", message: "[phone]" });
  });
});
