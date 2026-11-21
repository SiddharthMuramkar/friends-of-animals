import { afterEach, describe, expect, it, vi } from "vitest";

const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";

/**
 * POST as a staging server runs it, with `dsn` as NEXT_PUBLIC_SENTRY_DSN.
 * The route reads its config through the real `env()`, which parses
 * process.env on first use and keeps the result, so each test stubs the
 * variables first and then loads a fresh copy of the route.
 */
async function stagingPost(dsn: string | undefined) {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("APP_URL", "https://staging.example.invalid");
  // Required by the schema; nothing here connects to it.
  vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/foa");
  // Staging refuses to start without a session secret of 32 characters.
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  vi.resetModules();
  const { POST } = await import("./route");
  return POST;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const event = [
  JSON.stringify({ dsn: DSN }),
  JSON.stringify({ type: "event" }),
  JSON.stringify({ message: "boom", environment: "local" }),
].join("\n");

const post = () =>
  new Request("https://staging.example.invalid/monitoring", {
    method: "POST",
    body: event,
  });

describe("POST /monitoring", () => {
  it("answers 404 while NEXT_PUBLIC_SENTRY_DSN is unset", async () => {
    const POST = await stagingPost(undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect((await POST(post())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 404 while NEXT_PUBLIC_SENTRY_DSN is empty, as .env.example leaves it", async () => {
    const POST = await stagingPost("");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect((await POST(post())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards to the configured project, tagged with the server's APP_ENV", async () => {
    const POST = await stagingPost(DSN);
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const response = await POST(post());

    expect(response.status).toBe(200);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.us.sentry.io/api/4507/envelope/");
    expect(new TextDecoder().decode(init.body as Uint8Array)).toContain(
      '"environment":"staging"'
    );
  });
});
