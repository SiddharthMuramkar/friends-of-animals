import { describe, expect, it } from "vitest";

import { SITE_IMAGE_IDS } from "@/lib/images/credits";

import { STORIES, STORY_SLUGS, latestStories, loadArticle } from ".";
import { articleBodySchema } from "./model";

describe("story registry", () => {
  it("lists the five articles from DIRECTION §7 with unique slugs", () => {
    expect(STORIES).toHaveLength(5);
    expect(new Set(STORY_SLUGS).size).toBe(5);
  });

  it("keeps deks within the 300-character excerpt limit", () => {
    for (const s of STORIES)
      expect(s.dek.length, s.slug).toBeLessThanOrEqual(300);
  });

  it("uses only credited covers", () => {
    for (const s of STORIES)
      if (s.coverImageId) expect(SITE_IMAGE_IDS).toContain(s.coverImageId);
  });

  it("orders latest stories featured first, then newest", () => {
    const latest = latestStories(3);
    expect(latest).toHaveLength(3);
    expect(latest[0]!.featured).toBe(true);
  });

  it("loads a valid body for every slug", async () => {
    for (const slug of STORY_SLUGS) {
      const body = await loadArticle(slug);
      expect(body.blocks.length, slug).toBeGreaterThan(0);
    }
  });
});

describe("articleBodySchema", () => {
  it("rejects a footnote reference with no source", () => {
    const bad = {
      blocks: [{ type: "paragraph", text: ["A fact.", { fn: "f1" }] }],
      footnotes: [],
    };
    expect(articleBodySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a source no paragraph cites", () => {
    const bad = {
      blocks: [{ type: "paragraph", text: ["A fact."] }],
      footnotes: [{ id: "f1", text: "Somewhere", url: "https://example.org" }],
    };
    expect(articleBodySchema.safeParse(bad).success).toBe(false);
  });

  it("accepts footnotes cited from lists and callouts", () => {
    const ok = {
      blocks: [
        { type: "list", style: "bullet", items: [["One", { fn: "f1" }]] },
        { type: "callout", tone: "info", body: [["Two", { fn: "f2" }]] },
      ],
      footnotes: [
        { id: "f1", text: "A", url: "https://example.org/a" },
        { id: "f2", text: "B", url: "https://example.org/b" },
      ],
    };
    expect(articleBodySchema.safeParse(ok).success).toBe(true);
  });
});
