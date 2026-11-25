import { describe, expect, it } from "vitest";

import { renderHtml } from "@/test/render";
import { XSS_CORPUS } from "@/test/xss-corpus";

import { EssayText } from "./essay-text";

// A typed essay is shown as text (#86): whatever a participant typed, or a
// stored row holds, no element of theirs reaches the page.

describe("EssayText", () => {
  it("shows paragraphs and line breaks, and nothing else of its own", async () => {
    const html = await renderHtml(
      <EssayText
        body={{ paragraphs: [["First line", "second line"], ["Next one"]] }}
      />
    );
    expect(html).toBe(
      '<div class="flex flex-col gap-3 text-ink">' +
        '<p class="wrap-anywhere"><span>First line</span><span><br/>second line</span></p>' +
        '<p class="wrap-anywhere"><span>Next one</span></p>' +
        "</div>"
    );
  });

  it("escapes every payload of the corpus, so none becomes an element", async () => {
    const html = await renderHtml(
      <EssayText body={{ paragraphs: [[...XSS_CORPUS]] }} />
    );
    const tags = [...html.matchAll(/<([a-z]+)/g)].map((match) => match[1]);
    expect(new Set(tags)).toEqual(new Set(["div", "p", "span", "br"]));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows only what the essay profile lets through from a stored row", async () => {
    const html = await renderHtml(
      <EssayText
        body={
          {
            paragraphs: [["kept", { html: "<b>x</b>" }]],
            html: "<script>alert(1)</script>",
          } as never
        }
      />
    );
    expect(html).not.toContain("script");
    expect(html).toContain("kept");
  });
});
