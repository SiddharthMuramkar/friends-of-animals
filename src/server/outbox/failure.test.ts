import { describe, expect, it } from "vitest";

import { MAX_FAILURE_LENGTH, describeFailure } from "./failure";

describe("describeFailure", () => {
  it("names the error and keeps its message", () => {
    expect(describeFailure(new TypeError("Cannot read properties"))).toBe(
      "TypeError: Cannot read properties"
    );
  });

  it("uses the name alone when the message is empty", () => {
    class EmailNotConfiguredError extends Error {
      override name = "EmailNotConfiguredError";
    }
    expect(describeFailure(new EmailNotConfiguredError())).toBe(
      "EmailNotConfiguredError"
    );
  });

  it("keeps the first line only, so no stack or payload dump is stored", () => {
    expect(
      describeFailure(new Error("Provider refused\n  at send (ses.ts:10)"))
    ).toBe("Error: Provider refused");
  });

  it("hides email addresses", () => {
    expect(
      describeFailure(new Error("Mailbox Asha.Rao+foa@Example.test is full"))
    ).toBe("Error: Mailbox [email] is full");
  });

  it("hides phone numbers in the usual Indian forms", () => {
    expect(describeFailure(new Error("No route to +91 98765 43210"))).toBe(
      "Error: No route to [phone]"
    );
    expect(describeFailure(new Error("Number 9876543210 is on DND"))).toBe(
      "Error: Number [phone] is on DND"
    );
    expect(describeFailure(new Error("Bad number 098765-43210."))).toBe(
      "Error: Bad number [phone]."
    );
  });

  it("keeps ids, Postgres error codes and counts, which say what failed", () => {
    const message =
      "Delivery 01938a00-0000-7000-8000-000000000101 failed: Postgres 23505 after 3 tries, HTTP 403";
    expect(describeFailure(new Error(message))).toBe(`Error: ${message}`);
    expect(
      describeFailure(new Error("Insert refused (SQLSTATE 40001), retry"))
    ).toBe("Error: Insert refused (SQLSTATE 40001), retry");
  });

  it("hides one-time codes and other bare numbers of four digits or more", () => {
    expect(describeFailure(new Error("Code 482913 rejected for sign-in"))).toBe(
      "Error: Code [number] rejected for sign-in"
    );
    expect(describeFailure(new Error("PIN 4821 and ref 123456789"))).toBe(
      "Error: PIN [number] and ref [number]"
    );
  });

  it("drops URL query strings and fragments, where tokens travel", () => {
    expect(
      describeFailure(
        new Error(
          "GET https://x.test/verify?token=s3cr3tT0k3nValue&email=asha%40example.test 403"
        )
      )
    ).toBe("Error: GET https://x.test/verify?[query] 403");
    expect(
      describeFailure(new Error("Redirected to https://x.test/done#code=abc"))
    ).toBe("Error: Redirected to https://x.test/done?[query]");
  });

  it("hides percent-encoded email addresses", () => {
    expect(
      describeFailure(new Error("Unknown recipient asha%40example.test"))
    ).toBe("Error: Unknown recipient [email]");
  });

  it("hides Bearer and Basic credentials", () => {
    expect(
      describeFailure(
        new Error("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc rejected")
      )
    ).toBe("Error: Authorization: Bearer [credential] rejected");
    expect(describeFailure(new Error("basic YXNoYTpzZWNyZXQ= refused"))).toBe(
      "Error: basic [credential] refused"
    );
  });

  it("describes thrown strings, and only the type of other values", () => {
    expect(describeFailure("timeout for ravi@example.test")).toBe(
      "timeout for [email]"
    );
    expect(describeFailure({ email: "ravi@example.test" })).toBe(
      "Thrown value of type object"
    );
    expect(describeFailure(undefined)).toBe("Thrown value of type undefined");
  });

  it(`cuts long messages to ${MAX_FAILURE_LENGTH} characters`, () => {
    const described = describeFailure(new Error("x".repeat(2000)));

    expect(described).toHaveLength(MAX_FAILURE_LENGTH);
    expect(described.startsWith("Error: xxx")).toBe(true);
    expect(described.endsWith("…")).toBe(true);
  });

  it("hides an address before cutting, so no part of it is kept", () => {
    const padding = "y".repeat(MAX_FAILURE_LENGTH - 15);
    const described = describeFailure(
      new Error(`${padding} meera.iyer@example.test`)
    );

    expect(described).not.toContain("meera");
    expect(described).not.toContain("example.test");
  });
});
