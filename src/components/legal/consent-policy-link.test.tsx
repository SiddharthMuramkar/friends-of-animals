import { describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import { ConsentPolicyLink } from "./consent-policy-link";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

const PUBLISHED_AT = new Date("2026-11-20T10:00:00Z");

// The consent screens link a consent document to the policy page it rests
// on, at the version that page shows now (#111).
describe("<ConsentPolicyLink>", () => {
  it("links the messages consent to the privacy policy, with its current version", async () => {
    const html = await renderHtml(
      <ConsentPolicyLink
        purpose="messages"
        current={{ version: 3, publishedAt: PUBLISHED_AT }}
      />
    );

    expect(visibleText(html)).toBe("See also our privacy policy, version 3.");
    expect(html).toMatch(
      /<a\b[^>]*\shref="\/privacy"[^>]*>privacy policy<\/a>/
    );
  });

  it("links the terms to the terms of use page", async () => {
    const html = await renderHtml(
      <ConsentPolicyLink
        purpose="terms"
        current={{ version: 2, publishedAt: PUBLISHED_AT }}
      />
    );

    expect(visibleText(html)).toBe("See also our terms of use, version 2.");
    expect(html).toMatch(/<a\b[^>]*\shref="\/terms"[^>]*>terms of use<\/a>/);
  });

  it("leaves the version out while the page has none published", async () => {
    const html = await renderHtml(
      <ConsentPolicyLink purpose="messages" current={null} />
    );

    expect(visibleText(html)).toBe("See also our privacy policy.");
    expect(html).toMatch(
      /<a\b[^>]*\shref="\/privacy"[^>]*>privacy policy<\/a>/
    );
  });
});
