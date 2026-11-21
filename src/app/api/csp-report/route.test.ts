import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

// The route keeps its report budget per server instance, in module state:
// each test loads a fresh copy under a fake clock.
let POST: (request: Request) => Promise<Response>;
let warn: MockInstance<typeof console.warn>;

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date("2026-11-21T10:00:00Z") });
  vi.resetModules();
  ({ POST } = await import("./route"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const PAGE = "https://foa.example.test/account/sessions";

function post(body: string, contentType = "application/csp-report") {
  return POST(
    new Request("https://foa.example.test/api/csp-report", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    })
  );
}

/** A legacy report-uri body, as Chrome and Safari send it. */
function legacyReport(documentUri = `${PAGE}?email=meera@example.test#top`) {
  return JSON.stringify({
    "csp-report": {
      "document-uri": documentUri,
      referrer: "https://foa.example.test/sign-in?email=meera@example.test",
      "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem",
      "original-policy": "default-src 'self'; script-src 'self'",
      "blocked-uri": "inline",
      "script-sample": "alert(document.cookie)",
      "source-file": `${PAGE}?token=abc123`,
      "line-number": 12,
      "column-number": 3,
      disposition: "report",
      "status-code": 200,
    },
  });
}

/** A Reporting API batch of `count` violations. */
function batch(count: number) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      type: "csp-violation",
      age: 10,
      url: `${PAGE}?n=${i}`,
      user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      body: {
        documentURL: `${PAGE}?n=${i}`,
        effectiveDirective: "script-src-elem",
        blockedURL: "https://evil.example.test/x.js?session=secret",
        disposition: "enforce",
        sample: "",
      },
    }))
  );
}

function loggedLines(): Record<string, unknown>[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)));
}

describe("POST /api/csp-report", () => {
  it("logs one scrubbed line for a report-uri violation and answers 204", async () => {
    const response = await post(legacyReport());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(loggedLines()).toEqual([
      {
        event: "csp.violation",
        documentUrl: PAGE,
        directive: "script-src-elem",
        blocked: "inline",
        sourceFile: PAGE,
        line: 12,
        column: 3,
        disposition: "report",
      },
    ]);
    const logged = warn.mock.calls.flat().join("\n");
    for (const personal of ["meera", "abc123", "alert(", "sign-in"]) {
      expect(logged).not.toContain(personal);
    }
  });

  it("logs each violation of a Reporting API batch without its user agent", async () => {
    const response = await post(batch(2), "application/reports+json");

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([
      {
        event: "csp.violation",
        documentUrl: PAGE,
        directive: "script-src-elem",
        blocked: "https://evil.example.test/x.js",
        disposition: "enforce",
      },
      {
        event: "csp.violation",
        documentUrl: PAGE,
        directive: "script-src-elem",
        blocked: "https://evil.example.test/x.js",
        disposition: "enforce",
      },
    ]);
    const logged = warn.mock.calls.flat().join("\n");
    expect(logged).not.toContain("iPhone");
    expect(logged).not.toContain("secret");
  });

  it("refuses other content types, oversize bodies and malformed reports", async () => {
    expect((await post(legacyReport(), "text/plain")).status).toBe(415);
    expect((await post(legacyReport(), "application/json")).status).toBe(415);
    const oversize = legacyReport(`${PAGE}?pad=${"x".repeat(20_000)}`);
    expect((await post(oversize)).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ nope: 1 }))).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops logging past 100 violations a minute, and starts again after", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await post(batch(20), "application/reports+json");
      expect(response.status).toBe(204);
    }
    expect(warn).toHaveBeenCalledTimes(100);

    const over = await post(legacyReport());
    expect(over.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(100);

    vi.advanceTimersByTime(60_000);
    await post(legacyReport());
    expect(warn).toHaveBeenCalledTimes(101);
  });
});
