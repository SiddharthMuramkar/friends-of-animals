import { describe, expect, it } from "vitest";

import {
  CSP_REPORT_MAX_BYTES,
  createReportBudget,
  parseCspReport,
} from "./csp-report";

const legacy = (report: Record<string, unknown>) =>
  JSON.stringify({ "csp-report": report });

describe("parseCspReport: application/csp-report", () => {
  it("keeps where and what, and drops queries, fragments and samples", () => {
    const result = parseCspReport(
      "application/csp-report",
      legacy({
        "document-uri":
          "https://friendsofanimals.dev/account/sessions?email=asha@example.test#top",
        referrer: "https://mail.example.test/inbox?id=42",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "original-policy": "default-src 'self'; script-src 'nonce-abc'",
        disposition: "enforce",
        "blocked-uri": "https://evil.example.test/x.js?token=secret",
        "line-number": 12,
        "column-number": 7,
        "source-file":
          "https://friendsofanimals.dev/_next/static/chunks/a.js?v=1",
        "status-code": 200,
        "script-sample": "alert('asha@example.test')",
      })
    );

    expect(result).toEqual({
      ok: true,
      violations: [
        {
          documentUrl: "https://friendsofanimals.dev/account/sessions",
          directive: "script-src-elem",
          blocked: "https://evil.example.test/x.js",
          sourceFile: "https://friendsofanimals.dev/_next/static/chunks/a.js",
          line: 12,
          column: 7,
          disposition: "enforce",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/asha|secret|inbox|nonce/);
  });

  it("keeps the inline and eval keywords and only the scheme of data URLs", () => {
    const blocked = (uri: string) => {
      const result = parseCspReport(
        "application/csp-report; charset=utf-8",
        legacy({
          "document-uri": "https://friendsofanimals.dev/",
          "effective-directive": "script-src",
          "blocked-uri": uri,
        })
      );
      return result.ok ? result.violations[0]?.blocked : undefined;
    };

    expect(blocked("inline")).toBe("inline");
    expect(blocked("eval")).toBe("eval");
    expect(blocked("data:text/html;base64,PHNjcmlwdD4=")).toBe("data:");
    expect(blocked("chrome-extension://abcdef/content.js")).toBe(
      "chrome-extension:"
    );
    expect(blocked("not a url")).toBe("other");
  });
});

describe("parseCspReport: application/reports+json", () => {
  it("reads each csp-violation in a batch and ignores other report types", () => {
    const result = parseCspReport(
      "application/reports+json",
      JSON.stringify([
        {
          type: "csp-violation",
          age: 10,
          url: "https://friendsofanimals.dev/account?code=123456",
          user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
          body: {
            documentURL: "https://friendsofanimals.dev/account?code=123456",
            referrer:
              "https://friendsofanimals.dev/sign-in?email=asha@example.test",
            blockedURL: "inline",
            effectiveDirective: "script-src-attr",
            originalPolicy: "script-src 'nonce-abc'",
            sourceFile: "https://friendsofanimals.dev/account",
            sample: "onclick=steal()",
            disposition: "report",
            statusCode: 200,
            lineNumber: 3,
            columnNumber: 14,
          },
        },
        { type: "deprecation", url: "https://friendsofanimals.dev/", body: {} },
      ])
    );

    expect(result).toEqual({
      ok: true,
      violations: [
        {
          documentUrl: "https://friendsofanimals.dev/account",
          directive: "script-src-attr",
          blocked: "inline",
          sourceFile: "https://friendsofanimals.dev/account",
          line: 3,
          column: 14,
          disposition: "report",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /asha|123456|iPhone|steal|nonce/
    );
  });

  it("keeps at most 20 violations from one batch", () => {
    const one = {
      type: "csp-violation",
      body: {
        documentURL: "https://friendsofanimals.dev/",
        blockedURL: "eval",
        effectiveDirective: "script-src",
      },
    };
    const result = parseCspReport(
      "application/reports+json",
      JSON.stringify(Array.from({ length: 50 }, () => one))
    );
    expect(result.ok && result.violations).toHaveLength(20);
  });
});

describe("parseCspReport: refusals", () => {
  it("refuses a body over the size cap", () => {
    const big = legacy({
      "document-uri": "https://friendsofanimals.dev/",
      padding: "x".repeat(CSP_REPORT_MAX_BYTES),
    });
    expect(parseCspReport("application/csp-report", big)).toEqual({
      ok: false,
      status: 413,
    });
  });

  it("measures the cap in bytes, not characters", () => {
    const body = legacy({
      "document-uri": "https://friendsofanimals.dev/",
      x: "",
    });
    const multibyte = "ह".repeat(
      Math.ceil((CSP_REPORT_MAX_BYTES - body.length) / 3) + 10
    );
    expect(
      parseCspReport(
        "application/csp-report",
        legacy({
          "document-uri": "https://friendsofanimals.dev/",
          x: multibyte,
        })
      )
    ).toEqual({ ok: false, status: 413 });
  });

  it("refuses other content types", () => {
    for (const type of [
      null,
      "text/plain",
      "application/json",
      "text/html",
      "constructor",
      "__proto__",
    ]) {
      expect(parseCspReport(type, legacy({}))).toEqual({
        ok: false,
        status: 415,
      });
    }
  });

  it("refuses bodies that aren't reports", () => {
    expect(parseCspReport("application/csp-report", "{not json")).toEqual({
      ok: false,
      status: 400,
    });
    expect(parseCspReport("application/csp-report", "[]")).toEqual({
      ok: false,
      status: 400,
    });
    expect(parseCspReport("application/reports+json", "{}")).toEqual({
      ok: false,
      status: 400,
    });
  });

  it("keeps only the scheme of a page that isn't a web URL", () => {
    expect(
      parseCspReport(
        "application/csp-report",
        legacy({ "document-uri": "about:blank#x", "blocked-uri": "inline" })
      )
    ).toEqual({
      ok: true,
      violations: [
        { documentUrl: "about:", directive: "unknown", blocked: "inline" },
      ],
    });
  });

  it("skips a report without a page URL", () => {
    expect(
      parseCspReport(
        "application/csp-report",
        legacy({ "blocked-uri": "inline" })
      )
    ).toEqual({ ok: true, violations: [] });
  });
});

describe("createReportBudget", () => {
  it("lets a fixed number of violations through per window, for everyone", () => {
    let now = Date.parse("2027-01-15T04:30:00.000Z");
    const budget = createReportBudget({
      limit: 5,
      windowMs: 60_000,
      now: () => now,
    });

    expect(budget.take(3)).toBe(3);
    expect(budget.take(3)).toBe(2);
    expect(budget.take(1)).toBe(0);

    now += 59_999;
    expect(budget.take(1)).toBe(0);
    now += 1;
    expect(budget.take(10)).toBe(5);
  });
});
