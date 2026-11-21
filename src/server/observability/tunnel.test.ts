import { describe, expect, it, vi } from "vitest";

import { handleTunnelRequest, type TunnelInput } from "./tunnel";

const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";
const OTHER_DSN = "https://zzz999@o9.ingest.us.sentry.io/1";
const SENTRY_URL = "https://o1.ingest.us.sentry.io/api/4507/envelope/";
const decoder = new TextDecoder();

/** Envelope lines joined the way the browser SDK writes them. */
const envelope = (...lines: object[]) =>
  lines.map((line) => JSON.stringify(line)).join("\n");

const browserEvent = envelope(
  { event_id: "e1", dsn: DSN, sent_at: "2026-11-21T06:00:00.000Z" },
  { type: "event" },
  {
    message: "No account for asha@example.test",
    environment: "local",
    request: {
      url: "https://shipped-it.dev/sign-in?email=asha@example.test",
      headers: { Cookie: "session=abc123", "User-Agent": "Safari" },
    },
  }
);

const post = (body: BodyInit, headers?: HeadersInit) =>
  new Request("https://shipped-it.dev/monitoring", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8", ...headers },
    body,
  });

/** A fetch that records what it was sent and answers like Sentry. */
function sentryStub(response = new Response("{}", { status: 200 })) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    response.clone()
  );
}

function tunnel(overrides: Partial<TunnelInput> = {}): TunnelInput {
  return {
    dsn: DSN,
    environment: "staging",
    fetch: sentryStub(),
    ...overrides,
  };
}

describe("handleTunnelRequest", () => {
  it("answers 404 and sends nothing while error tracking is off", async () => {
    const fetch = sentryStub();

    for (const dsn of [undefined, ""]) {
      const response = await handleTunnelRequest(
        post(browserEvent),
        tunnel({ dsn, fetch })
      );
      expect(response.status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards our project's envelope to Sentry, scrubbed and tagged with APP_ENV", async () => {
    const fetch = sentryStub();

    const response = await handleTunnelRequest(
      post(browserEvent),
      tunnel({ fetch })
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(SENTRY_URL);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/x-sentry-envelope"
    );
    const forwarded = decoder.decode(init?.body as Uint8Array);
    const [, , payload] = forwarded.split("\n");
    expect(JSON.parse(payload!)).toEqual({
      message: "No account for [email]",
      environment: "staging",
      request: { url: "https://shipped-it.dev/sign-in" },
    });
    expect(forwarded).not.toContain("asha");
    expect(forwarded).not.toContain("session=abc123");
  });

  it("refuses an envelope for any other Sentry project", async () => {
    const fetch = sentryStub();
    const foreign = browserEvent.replace(DSN, OTHER_DSN);

    const response = await handleTunnelRequest(
      post(foreign),
      tunnel({ fetch })
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an envelope", async () => {
    const fetch = sentryStub();

    const response = await handleTunnelRequest(
      post("<html>hello</html>"),
      tunnel({ fetch })
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 MiB with 413, sending nothing", async () => {
    const fetch = sentryStub();
    const huge = envelope(
      { dsn: DSN },
      { type: "event" },
      { message: "x".repeat(1024 * 1024) }
    );

    const response = await handleTunnelRequest(post(huge), tunnel({ fetch }));

    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a body whose stated length is over the limit before reading it", async () => {
    const fetch = sentryStub();
    const body = new ReadableStream<Uint8Array>({
      pull: () => {
        throw new Error("the body should not be read");
      },
    });
    const request = new Request("https://shipped-it.dev/monitoring", {
      method: "POST",
      headers: { "Content-Length": String(2 * 1024 * 1024) },
      body,
      duplex: "half",
    } as RequestInit);

    const response = await handleTunnelRequest(request, tunnel({ fetch }));

    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 200 and sends nothing when every item is one it drops", async () => {
    const fetch = sentryStub();
    const sessionOnly = envelope(
      { dsn: DSN },
      { type: "session" },
      { sid: "s1", status: "ok" }
    );

    const response = await handleTunnelRequest(
      post(sessionOnly),
      tunnel({ fetch })
    );

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes Sentry's status and rate limits back, so the browser backs off", async () => {
    const limited = new Response("", {
      status: 429,
      headers: {
        "Retry-After": "60",
        "X-Sentry-Rate-Limits": "60:error:organization",
        "Set-Cookie": "sentry=1",
      },
    });

    const response = await handleTunnelRequest(
      post(browserEvent),
      tunnel({ fetch: sentryStub(limited) })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-sentry-rate-limits")).toBe(
      "60:error:organization"
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers 502 when Sentry can't be reached", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed")));

    const response = await handleTunnelRequest(post(browserEvent), {
      ...tunnel(),
      fetch,
    });

    expect(response.status).toBe(502);
  });

  it("is never cached", async () => {
    const response = await handleTunnelRequest(post(browserEvent), tunnel());

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
