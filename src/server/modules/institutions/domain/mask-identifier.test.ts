import { describe, expect, it } from "vitest";

import { maskIdentifier } from "./mask-identifier";

describe("maskIdentifier", () => {
  it("keeps an email's first letter and its domain", () => {
    expect(maskIdentifier("email", "asha.rao@school.test")).toBe(
      "a***@school.test"
    );
    expect(maskIdentifier("email", "t@example.test")).toBe("t***@example.test");
  });

  it("splits at the last @", () => {
    expect(maskIdentifier("email", '"a@b"@school.test')).toBe(
      '"***@school.test'
    );
  });

  it("keeps a phone number's last four digits", () => {
    expect(maskIdentifier("phone", "+919876543210")).toBe("***3210");
  });

  it("hides everything it can't parse", () => {
    expect(maskIdentifier("email", "no-at-sign")).toBe("***");
    expect(maskIdentifier("email", "@school.test")).toBe("***");
    expect(maskIdentifier("email", "asha@")).toBe("***");
    expect(maskIdentifier("phone", "+91")).toBe("***");
    expect(maskIdentifier("phone", "")).toBe("***");
  });
});
