import { describe, expect, it } from "vitest";

import { contactHref } from "./contact";

describe("contactHref()", () => {
  it("links an email address with mailto:", () => {
    expect(contactHref("email", " hello@example.org ")).toBe(
      "mailto:hello@example.org"
    );
  });

  it("dials a helpline number as written", () => {
    expect(contactHref("phone", "1098")).toBe("tel:1098");
  });

  it("drops spaces, dashes and brackets from a phone number", () => {
    expect(contactHref("phone", "+91 98765 43210")).toBe("tel:+919876543210");
    expect(contactHref("phone", "(022) 2345-6789")).toBe("tel:02223456789");
  });

  it("keeps a + only at the start", () => {
    expect(contactHref("phone", "+91 +98")).toBe("tel:+9198");
    expect(contactHref("phone", "98+76")).toBe("tel:9876");
  });
});
