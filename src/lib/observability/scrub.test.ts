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
      redactText(
        "GET https://friendsofanimals.dev/sign-in?email=a%40b.c#top 500"
      )
    ).toBe("GET https://friendsofanimals.dev/sign-in 500");
  });
});

describe("redactText: database errors", () => {
  // Shapes from Drizzle 0.45 (DrizzleQueryError) and Postgres messages.
  it("hides a failed query's parameters", () => {
    expect(
      redactText(
        'Failed query: insert into "user" ("id", "name", "email") values ($1, $2, $3)\n' +
          "params: 0190a000-0000-7000-8000-000000000002,Ravi Kumar Sharma,ravi@example.test"
      )
    ).toBe(
      'Failed query: insert into "user" ("id", "name", "email") values ($1, $2, $3)\n' +
        "params: [redacted]"
    );
  });

  it("hides the value Postgres quotes back, keeping quoted names", () => {
    expect(
      redactText('invalid input syntax for type uuid: "SESSIONTOKEN_s3cr3t"')
    ).toBe('invalid input syntax for type uuid: "[redacted]"');
    expect(
      redactText(
        'duplicate key value violates unique constraint "user_email_key"'
      )
    ).toBe('duplicate key value violates unique constraint "user_email_key"');
  });

  it("hides a quoted value to the end of its line, quotes inside it too", () => {
    // Postgres echoes the value raw, without escaping its quotes.
    expect(
      redactText('invalid input syntax for type uuid: "abc"Ravi Kumar"')
    ).toBe('invalid input syntax for type uuid: "[redacted]"');
    expect(
      redactText('invalid input value for enum role: "admin"\nnext line')
    ).toBe('invalid input value for enum role: "[redacted]"\nnext line');
  });

  it("hides every line of a quoted value that runs past its line", () => {
    expect(
      redactText(
        'invalid input syntax for type json: "first line\nRavi Kumar\n482913"'
      )
    ).toBe('invalid input syntax for type json: "[redacted]"');
  });

  it("hides the values of a duplicate key and of a failing row", () => {
    expect(redactText("Key (email)=(Ravi Kumar) already exists.")).toBe(
      "Key (email)=[redacted] already exists."
    );
    expect(redactText("Key (lower(name))=(Ravi Kumar) already exists.")).toBe(
      "Key (lower(name))=[redacted] already exists."
    );
    expect(
      redactText(
        "Failing row contains (0190a000-0000-7000-8000-000000000002, Ravi Kumar Sharma, f)."
      )
    ).toBe("Failing row contains [redacted]");
  });
});

describe("redactText on a duplicate key whose value has no closing bracket", () => {
  it("hides every line of a value that runs past its line", () => {
    expect(redactText("Key (email)=(Ravi\nKumar) already exists.")).toBe(
      "Key (email)=[redacted]"
    );
  });

  it("hides a value the text ends inside", () => {
    expect(redactText("Key (email)=(Ravi Kumar")).toBe(
      "Key (email)=[redacted]"
    );
  });

  it("hides a value cut off by truncation, brackets inside it included", () => {
    for (const value of ["Ravi Kumar ", "Ravi (Kumar) "]) {
      const text = `Key (email)=(${value.repeat(1000)}) already exists.`;

      expect(redactText(text)).toBe("Key (email)=[redacted][truncated]");
    }
  });
});

describe("redactText on a URL with a user and password in it", () => {
  it("hides them whatever the scheme", () => {
    expect(
      redactText("connect postgres://foa_worker:Zq8!fake@pg-prod:5432/foa")
    ).toBe("connect postgres://[redacted]@pg-prod:5432/foa");
    expect(
      redactText("GET https://asha:tok_fake@api.example.test/v1?x=1 500")
    ).toBe("GET https://[redacted]@api.example.test/v1 500");
  });

  it("hides a password that holds an unescaped @", () => {
    expect(redactText("redis://default:p@ss@cache:6379")).toBe(
      "redis://[redacted]@cache:6379"
    );
  });

  it("leaves URLs without them alone, an @ in the path too", () => {
    const text = "postgres://pg-prod:5432/foa and https://example.test/@asha";

    expect(redactText(text)).toBe(text);
    expect(redactText("postgres://[redacted]@pg-prod/foa")).toBe(
      "postgres://[redacted]@pg-prod/foa"
    );
  });
});

describe("stripQuery", () => {
  it("keeps the path of absolute and relative URLs", () => {
    expect(stripQuery("https://friendsofanimals.dev/a/b?x=1#y")).toBe(
      "https://friendsofanimals.dev/a/b"
    );
    expect(stripQuery("/api/x?phone=9876543210")).toBe("/api/x");
    expect(stripQuery("/plain")).toBe("/plain");
  });

  it("redacts a consent link path and keeps the route name", () => {
    expect(redactText("GET /consent/synthetic-token?done=1")).toBe(
      "GET /consent/[redacted]"
    );
  });

  it("redacts an entry page's Entry ID and keeps the new-entry form (#85)", () => {
    expect(
      stripQuery(
        "https://friendsofanimals.dev/participant/entries/NEIGH27-E-7K3QZ9"
      )
    ).toBe("https://friendsofanimals.dev/participant/entries/[redacted]");
    expect(redactText("GET /participant/entries/NEIGH27-E-7K3QZ9 failed")).toBe(
      "GET /participant/entries/[redacted] failed"
    );
    expect(stripQuery("/participant/entries/new?registration=x")).toBe(
      "/participant/entries/new"
    );
    expect(stripQuery("/participant/entries")).toBe("/participant/entries");
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
        url: "https://friendsofanimals.dev/sign-in?email=asha%40example.test",
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
      logentry: { message: "Sign-in failed for %s", params: "[redacted]" },
      user: { id: "u_01938a0000007000" },
      request: {
        method: "POST",
        url: "https://friendsofanimals.dev/sign-in",
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

describe("scrubEvent: database errors", () => {
  it("removes the values from every linked error, cause included", () => {
    const event = scrubEvent({
      exception: {
        values: [
          {
            type: "error",
            value: 'invalid input syntax for type uuid: "SESSIONTOKEN_s3cr3t"',
            mechanism: { type: "chained", source: "cause" },
          },
          {
            type: "DrizzleQueryError",
            value:
              'Failed query: select "id" from "session" where "session"."token" = $1\n' +
              "params: SESSIONTOKEN_s3cr3t",
          },
        ],
      },
    });

    expect(event.exception.values.map((value) => value.value)).toEqual([
      'invalid input syntax for type uuid: "[redacted]"',
      'Failed query: select "id" from "session" where "session"."token" = $1\n' +
        "params: [redacted]",
    ]);
    expect(JSON.stringify(event)).not.toContain("SESSIONTOKEN");
  });

  it("redacts params and detail wherever they are attached", () => {
    const event = scrubEvent({
      extra: {
        params: ["Ravi Kumar Sharma", "ravi@example.test"],
        detail: "Failing row contains (Ravi Kumar Sharma).",
      },
    });

    expect(event.extra).toEqual({ params: "[redacted]", detail: "[redacted]" });
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

  it("removes database values a console breadcrumb copied", () => {
    const logged =
      'DrizzleQueryError: Failed query: insert into "user" ("id", "name") values ($1, $2)\n' +
      "params: 0190a000-0000-7000-8000-000000000002,Ravi Kumar Sharma";
    const crumb = scrubBreadcrumb({
      category: "console",
      level: "error",
      message: logged,
      data: { arguments: [logged], logger: "console" },
    });

    expect(JSON.stringify(crumb)).not.toContain("Ravi");
    expect(crumb.message).toContain("params: [redacted]");
  });

  it("drops the query and fragment an outgoing-request breadcrumb keeps apart", () => {
    const crumb = scrubBreadcrumb({
      category: "http",
      data: {
        method: "GET",
        url: "https://api.example.test/v1/lookup",
        "url.query": "otp=482913",
        "url.fragment": "#otp=482913",
        "http.query": "name=Ravi",
        "http.fragment": "#code=482913",
        status_code: 200,
      },
    });

    expect(crumb.data).toEqual({
      method: "GET",
      url: "https://api.example.test/v1/lookup",
      status_code: 200,
    });
  });
});
