import { describe, expect, it } from "vitest";

import { stripMarkup } from "./strip-markup";

describe("stripMarkup", () => {
  it("keeps plain text, spacing and lone angle brackets as they are", () => {
    expect(stripMarkup("Read our policy, then write to us. ")).toBe(
      "Read our policy, then write to us. "
    );
    expect(stripMarkup("5 < 6 and 7 > 3")).toBe("5 < 6 and 7 > 3");
    expect(stripMarkup("I <3 dogs")).toBe("I <3 dogs");
    expect(stripMarkup("Line one\nLine two\tend")).toBe(
      "Line one\nLine two\tend"
    );
  });

  it("drops script and style elements with everything inside them", () => {
    expect(stripMarkup("Hi<script>alert(1)</script> there")).toBe("Hi there");
    expect(stripMarkup("a<SCRIPT type=module>x()</ScRiPt >b")).toBe("ab");
    expect(stripMarkup("a<style>body{display:none}</style>b")).toBe("ab");
  });

  it("drops other active elements with their content", () => {
    for (const tag of [
      "iframe",
      "object",
      "noscript",
      "template",
      "svg",
      "math",
      "textarea",
      "title",
      "xmp",
      "noembed",
      "noframes",
      "select",
    ]) {
      expect(stripMarkup(`a<${tag} x="1">inside</${tag}>b`), tag).toBe("ab");
    }
  });

  it("drops void elements such as embed without losing the text after", () => {
    expect(stripMarkup("a<embed src=x.swf>b<base href=//evil.test>c")).toBe(
      "abc"
    );
  });

  it("drops an unclosed active element to the end", () => {
    expect(stripMarkup("safe<script>alert(1)")).toBe("safe");
    expect(stripMarkup("safe<plaintext>anything after")).toBe("safe");
  });

  it("removes tags and attributes but keeps the text they wrap", () => {
    expect(stripMarkup('<a href="javascript:alert(1)">click</a>')).toBe(
      "click"
    );
    expect(stripMarkup("<b>bold</b> and <em>soft</em>")).toBe("bold and soft");
    expect(stripMarkup('x<img src=x onerror="alert(1)">y')).toBe("xy");
    expect(stripMarkup("x<br/>y<hr />z")).toBe("xyz");
  });

  it("is not fooled by a > inside a quoted attribute", () => {
    expect(stripMarkup('a<img alt=">" onerror=alert(1)>b')).toBe("ab");
    expect(stripMarkup("a<img alt='>' onerror=alert(1)>b")).toBe("ab");
  });

  it("drops a tag that never closes, as a browser does at the end", () => {
    expect(stripMarkup("x<img src=x onerror=alert(1)")).toBe("x");
    expect(stripMarkup('x<a href="')).toBe("x");
  });

  it("removes comments, declarations and processing instructions", () => {
    expect(stripMarkup("a<!-- <script>alert(1)</script> -->b")).toBe("ab");
    expect(stripMarkup("a<!-- never closed <b>")).toBe("a");
    // Outside SVG, CDATA is a bogus comment that ends at the first ">".
    expect(stripMarkup("a<![CDATA[<script>x</script>]]>b")).toBe("ax]]>b");
    expect(stripMarkup("a<!doctype html>b<?xml version='1'?>c")).toBe("abc");
    expect(stripMarkup("a</ 3>b")).toBe("ab");
  });

  it("does not rebuild a tag from the pieces of a nested one", () => {
    // "<scr<script>" is one tag named "scr<script", as a browser reads it.
    expect(stripMarkup("<scr<script>ipt>alert(1)</script>")).toBe(
      "ipt>alert(1)"
    );
    expect(stripMarkup("<<script>script>alert(1)<</script>/script>")).toBe("");
    expect(stripMarkup("<scr<b>ipt>alert(1)</scr</b>ipt>")).not.toMatch(/</);
  });

  it("leaves entity-encoded markup as inert text", () => {
    expect(stripMarkup("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("removes control characters and bidirectional overrides", () => {
    expect(stripMarkup("a\u0000b\u0007c\u001bd")).toBe("abcd");
    const bidi = String.fromCodePoint(0x202e, 0x2066, 0x2069, 0x202a);
    expect(stripMarkup(`ab${bidi[0]}cd${bidi[1]}e${bidi[2]}f${bidi[3]}`)).toBe(
      "abcdef"
    );
    const zeroWidthSpace = String.fromCodePoint(0x200b);
    expect(stripMarkup(`a${zeroWidthSpace}b`)).toBe(`a${zeroWidthSpace}b`);
  });

  it("is idempotent", () => {
    const inputs = [
      "<scr<script>ipt>alert(1)</script>tail",
      'x<img alt=">" onerror=alert(1)>y',
      "a<!-- c -->b<b>c</b>",
      "I <3 dogs < cats",
    ];
    for (const input of inputs) {
      const once = stripMarkup(input);
      expect(stripMarkup(once)).toBe(once);
    }
  });
});
