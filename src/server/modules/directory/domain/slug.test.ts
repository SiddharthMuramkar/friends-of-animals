import { describe, expect, it } from "vitest";

import { listingSlugBase, listingSlugCandidate } from "./slug";

describe("listingSlugBase", () => {
  it.each([
    ["Paws and Whiskers Trust", "paws-and-whiskers-trust"],
    ["  St. Francis' Animal Shelter (Pune) ", "st-francis-animal-shelter-pune"],
    ["Café Gaïa Rescue", "cafe-gaia-rescue"],
    ["Rescue #1 -- 24x7!!", "rescue-1-24x7"],
    ["ब्लू क्रॉस", "listing"],
    ["", "listing"],
  ])("makes %j into %j", (name, slug) => {
    expect(listingSlugBase(name)).toBe(slug);
  });

  it("cuts long names to 60 characters without a trailing hyphen", () => {
    const slug = listingSlugBase(`${"a".repeat(59)} b c`);
    expect(slug).toBe("a".repeat(59));
    expect(listingSlugBase("word ".repeat(30)).length).toBeLessThanOrEqual(60);
    expect(listingSlugBase("word ".repeat(30))).not.toMatch(/-$/);
  });

  it.each(["register", "Register", "search", "new"])(
    "never gives %j, which a /ngos route already uses",
    (name) => {
      expect(listingSlugBase(name)).toBe(`${name.toLowerCase()}-listing`);
    }
  );
});

describe("listingSlugCandidate", () => {
  it("tries the base first, then numbers it from 2", () => {
    expect(
      [1, 2, 3].map((attempt) => listingSlugCandidate("safe-paws", attempt))
    ).toEqual(["safe-paws", "safe-paws-2", "safe-paws-3"]);
  });
});
