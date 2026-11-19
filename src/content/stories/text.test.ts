import { describe, expect, it } from "vitest";

import { STORIES, STORY_SLUGS, loadArticle } from ".";
import type { ArticleBody } from "./model";
import {
  GROWN_UPS_TITLE,
  WHAT_YOU_CAN_DO_TITLE,
  articleWords,
  countSyllables,
  fleschKincaidGrade,
  kidText,
  metaDescription,
  readingMinutes,
  slugify,
  tableOfContents,
} from "./text";

describe("slugify", () => {
  it("makes stable, readable anchor ids", () => {
    expect(slugify("Kites up, birds out")).toBe("kites-up-birds-out");
    expect(slugify("“What if these were your babies?”")).toBe(
      "what-if-these-were-your-babies"
    );
    expect(slugify("Ten days of care in Gujarat")).toBe(
      "ten-days-of-care-in-gujarat"
    );
  });
});

describe("metaDescription", () => {
  it("keeps whole sentences within 160 characters", () => {
    expect(metaDescription("Short one.")).toBe("Short one.");
    const long = `${"A".repeat(100)}. ${"B".repeat(80)}.`;
    expect(metaDescription(long)).toBe(`${"A".repeat(100)}.`);
  });

  it("fits every story's description", () => {
    for (const s of STORIES)
      expect(metaDescription(s.dek).length, s.slug).toBeLessThanOrEqual(160);
  });
});

describe("tableOfContents", () => {
  it("lists level-2 headings with unique ids", () => {
    const body: ArticleBody = {
      blocks: [
        { type: "heading", level: 2, text: "One" },
        { type: "paragraph", text: ["x"] },
        { type: "heading", level: 3, text: "Sub" },
        { type: "heading", level: 2, text: "One" },
      ],
      footnotes: [],
    };
    expect(tableOfContents(body.blocks)).toEqual([
      { id: "one", text: "One" },
      { id: "one-2", text: "One" },
    ]);
  });
});

describe("readability", () => {
  it("counts syllables well enough for grade estimates", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("water")).toBe(2);
    expect(countSyllables("stork")).toBe(1);
    expect(countSyllables("beautiful")).toBe(3);
    expect(countSyllables("made")).toBe(1);
  });

  it("rates simple text low and dense text high", () => {
    expect(
      fleschKincaidGrade("The cat sat on the mat. The dog ran to the park.")
    ).toBeLessThan(2);
    expect(
      fleschKincaidGrade(
        "Parliamentary deliberations concerning institutional responsibilities necessitated comprehensive legislative consideration."
      )
    ).toBeGreaterThan(12);
  });

  it("reads one minute per 200 words, rounded up", () => {
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(400)).toBe(2);
    expect(readingMinutes(401)).toBe(3);
  });
});

describe("the five articles", () => {
  it.each(STORY_SLUGS)("%s is 500–900 words of body text", async (slug) => {
    const words = articleWords(await loadArticle(slug));
    expect(words).toBeGreaterThanOrEqual(500);
    expect(words).toBeLessThanOrEqual(900);
  });

  it.each(STORY_SLUGS)("%s states its reading time honestly", async (slug) => {
    const story = STORIES.find((s) => s.slug === slug)!;
    expect(story.readingMinutes).toBe(
      readingMinutes(articleWords(await loadArticle(slug)))
    );
  });

  it.each(STORY_SLUGS)("%s ends with a 'What you can do' box", async (slug) => {
    const { blocks } = await loadArticle(slug);
    expect(
      blocks.some(
        (b) => b.type === "callout" && b.title === WHAT_YOU_CAN_DO_TITLE
      )
    ).toBe(true);
  });

  it.each(STORY_SLUGS)("%s cites at least six sources", async (slug) => {
    const { footnotes } = await loadArticle(slug);
    expect(footnotes.length).toBeGreaterThanOrEqual(6);
  });

  const kids = STORIES.filter((s) => s.audience === "kids");

  it("has two kids' articles", () => expect(kids).toHaveLength(2));

  it.each(kids.map((s) => s.slug))(
    "%s reads at grade 6 or below, with a box for grown-ups",
    async (slug) => {
      const body = await loadArticle(slug);
      expect(fleschKincaidGrade(kidText(body))).toBeLessThanOrEqual(6);
      expect(
        body.blocks.some(
          (b) => b.type === "callout" && b.title === GROWN_UPS_TITLE
        )
      ).toBe(true);
    }
  );

  it.each(STORIES.map((s) => s.slug))(
    "%s has an easy-read line at grade 6 or below",
    (slug) => {
      const story = STORIES.find((s) => s.slug === slug)!;
      expect(fleschKincaidGrade(story.easyRead)).toBeLessThanOrEqual(6);
    }
  );

  // DIRECTION §4 and §5: banned words and unsafe advice.
  const BANNED = [
    /make a difference/i,
    /furry friends/i,
    /together we can/i,
    /voiceless/i,
    /\bdelve/i,
    /tapestry/i,
    /testament/i,
    /\bjourney\b/i,
    /\bempower/i,
    /\bunlock/i,
    /greatness of a nation/i,
    /feed (the )?(street )?(dogs|cats|pigeons)/i,
    /\bmilk\b/i,
    /!/,
  ];

  it.each(STORY_SLUGS)("%s avoids banned words and advice", async (slug) => {
    const text = JSON.stringify(await loadArticle(slug));
    for (const re of BANNED) expect(text, String(re)).not.toMatch(re);
  });
});
