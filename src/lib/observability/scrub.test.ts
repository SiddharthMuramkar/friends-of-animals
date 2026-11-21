import { describe, expect, it } from "vitest";

import { redactText, scrubBreadcrumb, scrubEvent, stripQuery } from "./scrub";

// Every value below is fake: example.test addresses and an unallocated
// mobile number.
const hashUserId = (id: string) => `u_${id.replace(/-/g, "").slice(0, 16)}`;

describe("redactText", () => {
  it("replaces email addresses", () => {
    expect(redactText("No account for Asha.Rao+foa@example.test.")).toBe(
      "No account for [email]."
    );
  });

  it("replaces Indian mobile numbers however they are written", () => {
    for (const phone of [
      "+91 98765 43210",
      "+91-98765-43210",
      "+919876543210",
      "919876543210",
      "09876543210",
      "9876543210",
      "98765 43210",
      "0091 98765 43210",
    ]) {
      expect(redactText(`SMS to ${phone} failed`)).toBe(
        "SMS to [phone] failed"
      );
    }
  });

  it("leaves numbers that are not mobile numbers alone", () => {
    const text =
      "epoch 1795237726, at 1795237726123 ms, id " +
      "01938a00-0000-7000-8000-000000000101, SQLSTATE 23505, 2027-01-15";
    expect(redactText(text)).toBe(text);
  });

  it("drops the query string and fragment of absolute URLs", () => {
    expect(
      redactText("GET https://shipped-it.dev/sign-in?email=a%40b.c#top 500")
    ).toBe("GET https://shipped-it.dev/sign-in 500");
  });
});

describe("stripQuery", () => {
  it("keeps the path of absolute and relative URLs", () => {
    expect(stripQuery("https://shipped-it.dev/a/b?x=1#y")).toBe(
      "https://shipped-it.dev/a/b"
    );
    expect(stripQuery("/api/x?phone=9876543210")).toBe("/api/x");
    expect(stripQuery("/plain")).toBe("/plain");
  });
});

describe("scrubEvent", () => {
  it("removes personal data from a full event", () => {
    const event = {
      event_id: "abc123",
      environment: "staging",
      message: "Could not send code to asha@example.test or +91 98765 43210",
      transaction: "GET /sign-in?email=asha@example.test",
      logentry: {
        message: "Sign-in failed for %s",
        params: ["asha@example.test"],
      },
      user: {
        id: "01938a00-0000-7000-8000-000000000101",
        email: "asha@example.test",
        username: "Asha Rao",
        ip_address: "203.0.113.10",
      },
      request: {
        method: "POST",
        url: "https://shipped-it.dev/sign-in?email=asha%40example.test",
        query_string: "email=asha%40example.test",
        data: { email: "asha@example.test", name: "Asha Rao" },
        cookies: { "better-auth.session_token": "secret-cookie" },
        headers: {
          Authorization: "Bearer secret-token",
          Cookie: "better-auth.session_token=secret-cookie",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
          "X-Forwarded-For": "203.0.113.10",
          "x-vercel-id": "bom1::abc",
        },
        env: { REMOTE_ADDR: "203.0.113.10" },
      },
      exception: {
        values: [
          {
            type: "Error",
            value: "Duplicate email asha@example.test",
            mechanism: { type: "onerror", handled: false },
            stacktrace: {
              frames: [
                {
                  filename: "app:///_next/static/chunks/a.js?dpl=123",
                  function: "submit",
                  lineno: 1,
                  vars: { email: "asha@example.test" },
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "fetch",
          data: {
            method: "GET",
            url: "/api/x?phone=9876543210",
            status_code: 500,
          },
        },
        { category: "console", message: "hello asha@example.test" },
      ],
      extra: {
        guardianName: "Meera Iyer",
        first_name: "Asha",
        attempt: 2,
        note: "call 9876543210",
        nested: { phone_number: "9876543210", ok: true },
      },
      tags: { route: "/sign-in?email=asha@example.test", runtime: "node" },
      contexts: {
        os: { name: "iOS", version: "16.2" },
        browser: { name: "Mobile Safari", version: "16.2" },
        form: { fullName: "Asha Rao", step: "code" },
      },
      sdk: { name: "sentry.javascript.nextjs", version: "11.15.0" },
    };

    expect(scrubEvent(event, { hashUserId })).toEqual({
      event_id: "abc123",
      environment: "staging",
      message: "Could not send code to [email] or [phone]",
      transaction: "GET /sign-in",
      logentry: { message: "Sign-in failed for %s", params: ["[email]"] },
      user: { id: "u_01938a0000007000" },
      request: {
        method: "POST",
        url: "https://shipped-it.dev/sign-in",
        headers: {
          "Content-Type": "application/json",
          "x-vercel-id": "bom1::abc",
        },
      },
      exception: {
        values: [
          {
            type: "Error",
            value: "Duplicate email [email]",
            mechanism: { type: "onerror", handled: false },
            stacktrace: {
              frames: [
                {
                  filename: "app:///_next/static/chunks/a.js",
                  function: "submit",
                  lineno: 1,
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "fetch",
          data: { method: "GET", url: "/api/x", status_code: 500 },
        },
        { category: "console", message: "hello [email]" },
      ],
      extra: {
        guardianName: "[redacted]",
        first_name: "[redacted]",
        attempt: 2,
        note: "call [phone]",
        nested: { phone_number: "[redacted]", ok: true },
      },
      tags: { route: "/sign-in", runtime: "node" },
      contexts: {
        os: { name: "iOS", version: "16.2" },
        browser: { name: "Mobile Safari", version: "16.2" },
        form: { fullName: "[redacted]", step: "code" },
      },
      sdk: { name: "sentry.javascript.nextjs", version: "11.15.0" },
    });
  });

  it("drops the user entirely when no hash function is given", () => {
    const scrubbed = scrubEvent({ user: { id: "x", email: "a@b.test" } });
    expect(scrubbed).toEqual({});
  });

  it("gives the same result when run twice", () => {
    const event = {
      user: { id: "01938a00-0000-7000-8000-000000000101" },
      message: "to asha@example.test",
      request: { url: "/a?b=c", headers: { Cookie: "x" } },
    };
    const once = scrubEvent(event, { hashUserId });
    expect(scrubEvent(once, { hashUserId })).toEqual(once);
  });

  it("does not change the event it is given", () => {
    const event = { message: "to asha@example.test", extra: { name: "A" } };
    scrubEvent(event);
    expect(event).toEqual({
      message: "to asha@example.test",
      extra: { name: "A" },
    });
  });

  it("cuts off values nested too deeply to inspect", () => {
    let deep: Record<string, unknown> = { email: "asha@example.test" };
    for (let i = 0; i < 12; i++) deep = { level: deep };
    const scrubbed = scrubEvent({ extra: { deep } });
    expect(JSON.stringify(scrubbed)).not.toContain("example.test");
    expect(JSON.stringify(scrubbed)).toContain("[truncated]");
  });
});

describe("scrubBreadcrumb", () => {
  it("drops query strings from navigation and redacts console arguments", () => {
    expect(
      scrubBreadcrumb({
        category: "navigation",
        data: { from: "/a?email=x@y.test", to: "/b?p=9876543210" },
      })
    ).toEqual({ category: "navigation", data: { from: "/a", to: "/b" } });

    expect(
      scrubBreadcrumb({
        category: "console",
        level: "error",
        message: "Failed for asha@example.test",
        data: { arguments: ["Failed for", { email: "asha@example.test" }] },
      })
    ).toEqual({
      category: "console",
      level: "error",
      message: "Failed for [email]",
      data: { arguments: ["Failed for", { email: "[redacted]" }] },
    });
  });
});
