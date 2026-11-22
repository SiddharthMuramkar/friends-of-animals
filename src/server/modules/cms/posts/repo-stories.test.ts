import { describe, expect, it } from "vitest";

import { loadArticle } from "@/content/stories";

import { repoStoryCards, repoStoryView } from "./repo-stories";

describe("the repo stories as public posts (a build with no database)", () => {
  it("lists the five stories, each published at 00:00 IST on its date", () => {
    const cards = repoStoryCards();
    expect(cards.map((c) => c.slug)).toEqual([
      "rukmini-devi-and-indias-animal-law",
      "a-drawing-that-feeds-tiny-guests",
      "the-stork-that-gets-a-baby-shower",
      "two-pilots-two-puppies",
      "kinder-skies-in-kite-season",
    ]);
    for (const card of cards) {
      expect(card.kind, card.slug).toBe("story");
      expect(card.publishedAt.toISOString(), card.slug).toBe(
        "2026-11-17T18:30:00.000Z"
      );
      expect(card.updatedAt, card.slug).toEqual(card.publishedAt);
    }
  });

  it("keeps each story's words, flags and cover", () => {
    const [rukmini, kolam] = repoStoryCards();
    expect(rukmini).toMatchObject({
      title: "The dancer who shaped India’s animal law",
      seoTitle: "The dancer behind India’s animal law",
      audience: "everyone",
      topics: ["history", "law"],
      featured: true,
      readingMinutes: 4,
      cover: null,
    });
    expect(kolam).toMatchObject({
      seoTitle: "A drawing that feeds tiny guests",
      featured: false,
      cover: { source: "site", id: "care-kolam-rice" },
    });
    expect(kolam!.excerpt).toMatch(/^Each morning, rice-flour patterns/);
  });

  it("gives a story its body, easy read and no named author", async () => {
    const view = await repoStoryView("the-stork-that-gets-a-baby-shower");
    const article = await loadArticle("the-stork-that-gets-a-baby-shower");
    expect(view).toMatchObject({
      slug: "the-stork-that-gets-a-baby-shower",
      easyRead: expect.stringMatching(/^A giant stork in Assam/),
      authorName: null,
    });
    expect(view!.body).toEqual(article);
  });

  it("has no post for a slug that isn't a repo story", async () => {
    expect(await repoStoryView("not-a-story")).toBeNull();
  });
});
