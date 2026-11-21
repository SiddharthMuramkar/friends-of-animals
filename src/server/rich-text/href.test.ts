import { describe, expect, it } from "vitest";

import { linkRel, safeHref } from "./href";

describe("safeHref", () => {
  it.each([
    ["/", "/"],
    ["/safeguarding", "/safeguarding"],
    ["/blog/a-story?tab=1#top", "/blog/a-story?tab=1#top"],
    ["#who-we-are", "#who-we-are"],
    ["https://www.india.gov.in/", "https://www.india.gov.in/"],
    [
      "https://en.wikipedia.org/wiki/Dog_(animal)",
      "https://en.wikipedia.org/wiki/Dog_(animal)",
    ],
    ["mailto:hello@example.test", "mailto:hello@example.test"],
    ["tel:+91-80-1234-5678", "tel:+91-80-1234-5678"],
    ["  /about  ", "/about"],
  ])("allows %j", (raw, expected) => {
    expect(safeHref(raw)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\u0000script:alert(1)",
    "jav&#x61;script:alert(1)",
    "&#106;avascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://example.test/",
    "//evil.test/",
    "/\\evil.test/",
    "\\\\evil.test",
    "https://",
    "https:///path",
    "https://exa mple.test",
    "about:blank",
    "relative/path",
    "#",
    "#Bad Id",
    "mailto:",
    "mailto:not-an-address",
    "tel:call-me",
    '/x" onmouseover="alert(1)',
    "/x<script>",
    "",
    `/${"a".repeat(2048)}`,
  ])("refuses %j", (raw) => {
    expect(safeHref(raw)).toBeNull();
  });
});

describe("linkRel", () => {
  it("marks links to other sites so they can't reach back or pass rank", () => {
    expect(linkRel("https://example.test/")).toBe(
      "noopener noreferrer nofollow"
    );
  });

  it("leaves links on this site, anchors, mail and phone alone", () => {
    for (const href of [
      "/about",
      "#top",
      "mailto:a@example.test",
      "tel:+911",
    ]) {
      expect(linkRel(href)).toBeUndefined();
    }
  });
});
