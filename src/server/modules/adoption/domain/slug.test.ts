import { describe, expect, it } from "vitest";

import { ADOPTION_SLUG_PATTERN, adoptionSlugCandidates } from "./slug";

const ID = "01938a00-0000-7000-8000-00000a1b2c3d";

describe("adoptionSlugCandidates", () => {
  it("names the animal, its species and its city, then numbers them", () => {
    expect(adoptionSlugCandidates("Bruno", "dog", "Pune", ID)).toEqual([
      "bruno-dog-pune",
      "bruno-dog-pune-2",
      "bruno-dog-pune-3",
      "bruno-dog-pune-4",
      "bruno-dog-pune-0a1b2c3d",
    ]);
  });

  it("drops accents and punctuation", () => {
    expect(
      adoptionSlugCandidates("Mélo (Mr. Whiskers)", "cat", "Navi Mumbai", ID)[0]
    ).toBe("melo-mr-whiskers-cat-navi-mumbai");
  });

  it("falls back to species and city for a name with no Latin letters", () => {
    expect(adoptionSlugCandidates("मोती", "dog", "Pune", ID)[0]).toBe(
      "dog-pune"
    );
    expect(adoptionSlugCandidates("मोती", "dog", "पुणे", ID)[0]).toBe(
      "dog-0a1b2c3d"
    );
  });

  it("keeps every candidate within the pattern the route accepts", () => {
    const long = "Sir Reginald Fluffington the Third of the Western Ghats";
    for (const slug of adoptionSlugCandidates(
      long,
      "rabbit",
      "Thiruvananthapuram",
      ID
    )) {
      expect(slug).toMatch(ADOPTION_SLUG_PATTERN);
      expect(slug.endsWith("-")).toBe(false);
    }
  });

  it("ends with a candidate made unique by the listing id", () => {
    const [last] = adoptionSlugCandidates("Bruno", "dog", "Pune", ID).slice(-1);
    expect(last).toContain("0a1b2c3d");
  });
});
