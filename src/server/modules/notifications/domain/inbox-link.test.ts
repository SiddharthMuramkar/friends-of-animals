import { describe, expect, it } from "vitest";

import { isInboxLink } from "./inbox-link";

describe("isInboxLink()", () => {
  it("accepts a path on this site, with a query or fragment", () => {
    expect(isInboxLink("/account/inbox")).toBe(true);
    expect(isInboxLink("/competitions/paws-26?tab=rules#fees")).toBe(true);
  });

  it("refuses links to other sites", () => {
    expect(isInboxLink("https://example.com/")).toBe(false);
    expect(isInboxLink("//example.com/path")).toBe(false);
    expect(isInboxLink("/\\example.com")).toBe(false);
  });

  it("refuses script and data links", () => {
    expect(isInboxLink("javascript:alert(1)")).toBe(false);
    expect(isInboxLink("data:text/html,hi")).toBe(false);
  });

  it("refuses relative paths, spaces and control characters", () => {
    expect(isInboxLink("account/inbox")).toBe(false);
    expect(isInboxLink("")).toBe(false);
    expect(isInboxLink("/account inbox")).toBe(false);
    expect(isInboxLink("/account\n/inbox")).toBe(false);
    expect(isInboxLink("/\tevil")).toBe(false);
  });

  it("refuses very long links", () => {
    expect(isInboxLink(`/${"a".repeat(499)}`)).toBe(true);
    expect(isInboxLink(`/${"a".repeat(500)}`)).toBe(false);
  });
});
