import { describe, expect, it } from "vitest";

import { STORY_SLUGS } from "@/content/stories";

import { checkPostSlug, postSlugFrom } from "./post-slug";

describe("checkPostSlug", () => {
  it("accepts every story slug already on the site, so imports keep their URLs", () => {
    for (const slug of STORY_SLUGS) {
      expect(checkPostSlug(slug)).toEqual({ ok: true });
    }
  });

  it("accepts lower-case words joined by single hyphens", () => {
    expect(checkPostSlug("kite-season-2027")).toEqual({ ok: true });
    expect(checkPostSlug("abc")).toEqual({ ok: true });
    expect(checkPostSlug("a".repeat(80))).toEqual({ ok: true });
  });

  it("refuses slugs shorter than 3 or longer than 80 characters", () => {
    expect(checkPostSlug("ab")).toEqual({ ok: false, refusal: "too_short" });
    expect(checkPostSlug("")).toEqual({ ok: false, refusal: "too_short" });
    expect(checkPostSlug("a".repeat(81))).toEqual({
      ok: false,
      refusal: "too_long",
    });
  });

  it.each([
    "Kite-Season",
    "kite_season",
    "kite season",
    "-kite",
    "kite-",
    "kite--season",
    "kite/season",
    "पतंग-season",
    "kite%2Fseason",
  ])("refuses %j", (slug) => {
    expect(checkPostSlug(slug)).toEqual({
      ok: false,
      refusal: "invalid_format",
    });
  });
});

describe("postSlugFrom", () => {
  it("turns a title into a slug", () => {
    expect(postSlugFrom("Kinder skies in kite season")).toBe(
      "kinder-skies-in-kite-season"
    );
  });

  it("drops punctuation, quotes and accents", () => {
    expect(postSlugFrom("The dancer who shaped India’s animal law")).toBe(
      "the-dancer-who-shaped-india-s-animal-law"
    );
    expect(postSlugFrom("  Café crème: 2 dogs & 1 cat!  ")).toBe(
      "cafe-creme-2-dogs-1-cat"
    );
  });

  it("cuts a long title at a word boundary within 80 characters", () => {
    const title = `${"word ".repeat(30)}end`;
    const slug = postSlugFrom(title);
    expect(slug).not.toBeNull();
    expect(slug!.length).toBeLessThanOrEqual(80);
    expect(slug!.endsWith("-")).toBe(false);
    expect(slug).toBe(Array.from({ length: 16 }, () => "word").join("-"));
  });

  it("gives null when the title has too few Latin letters or digits", () => {
    expect(postSlugFrom("पतंग का मौसम")).toBeNull();
    expect(postSlugFrom("!!")).toBeNull();
    expect(postSlugFrom("ab")).toBeNull();
  });

  it("always gives a slug checkPostSlug accepts", () => {
    for (const title of [
      "Two pilots, two puppies and the start of Blue Cross",
      "A drawing that feeds a thousand tiny guests",
      "x".repeat(200),
      "Ünïcödé — titles… with “quotes”",
    ]) {
      const slug = postSlugFrom(title);
      expect(slug).not.toBeNull();
      expect(checkPostSlug(slug!)).toEqual({ ok: true });
    }
  });
});
