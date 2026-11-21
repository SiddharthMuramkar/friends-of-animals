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

  it("keeps ids, codes and counts, which say what failed", () => {
    const message =
      "Delivery 01938a00-0000-7000-8000-000000000101 failed: 23505 after 3 tries";
    expect(describeFailure(new Error(message))).toBe(`Error: ${message}`);
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
