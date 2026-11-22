import { describe, expect, it } from "vitest";

import { COMPETITION_SLUG_PATTERN, competitionSlugCandidates } from "./slug";

describe("competitionSlugCandidates()", () => {
  it("makes a lower-case, hyphenated slug from the name, then one with the code", () => {
    expect(
      competitionSlugCandidates("Neighbours on My Street", "NEIGH27")
    ).toEqual(["neighbours-on-my-street", "neighbours-on-my-street-neigh27"]);
  });

  it("drops accents and punctuation", () => {
    expect(
      competitionSlugCandidates("  Café Cats & Dogs: 2027! ", "CAFE27")[0]
    ).toBe("cafe-cats-dogs-2027");
  });

  it("uses the code when the name gives fewer than 3 usable characters", () => {
    expect(competitionSlugCandidates("पशु मित्र", "PASHU27")).toEqual([
      "pashu27",
    ]);
    expect(competitionSlugCandidates("Go", "GOGO27")).toEqual(["gogo27"]);
  });

  it("keeps slugs within 80 characters, cutting at a word", () => {
    const name =
      "The very long annual celebration of kindness to every animal living on our streets and in our homes";
    for (const slug of competitionSlugCandidates(name, "KIND27")) {
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug).toMatch(COMPETITION_SLUG_PATTERN);
      expect(slug.endsWith("-")).toBe(false);
    }
  });

  it("always matches the public slug pattern", () => {
    for (const name of ["Neighbours on My Street", "---", "A  B  C  D"]) {
      for (const slug of competitionSlugCandidates(name, "ABC27")) {
        expect(slug).toMatch(COMPETITION_SLUG_PATTERN);
      }
    }
  });
});
