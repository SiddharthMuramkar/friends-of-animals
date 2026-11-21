import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";

let config: { NEXT_PUBLIC_SENTRY_DSN?: string; APP_ENV: string };
vi.mock("@/env", () => ({ env: () => config }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const event = [
  JSON.stringify({ dsn: DSN }),
  JSON.stringify({ type: "event" }),
  JSON.stringify({ message: "boom", environment: "local" }),
].join("\n");

const post = () =>
  new Request("https://friendsofanimals.dev/monitoring", {
    method: "POST",
    body: event,
  });

describe("POST /monitoring", () => {
  it("answers 404 while NEXT_PUBLIC_SENTRY_DSN is unset", async () => {
    config = { APP_ENV: "staging" };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect((await POST(post())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards to the configured project, tagged with the server's APP_ENV", async () => {
    config = { NEXT_PUBLIC_SENTRY_DSN: DSN, APP_ENV: "staging" };
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
