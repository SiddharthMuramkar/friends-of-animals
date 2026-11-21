import { describe, expect, it } from "vitest";

import {
  GALLERY_TEXT_LIMITS,
  graphemeCount,
  normaliseGalleryStory,
  normaliseGalleryTitle,
} from "./text";

describe("gallery title", () => {
  it("trims and collapses every run of whitespace, line breaks included", () => {
    expect(normaliseGalleryTitle("  Tiger \t in\n\nthe   rain ")).toEqual({
      ok: true,
      value: "Tiger in the rain",
    });
  });

  it("drops control and bidirectional override characters", () => {
    expect(normaliseGalleryTitle("Cat\u0000 nap\u202E\u2066")).toEqual({
      ok: true,
      value: "Cat nap",
    });
  });

  it("keeps the joiners Indic scripts and emoji need", () => {
    const title = "क्\u200Dष 👩\u200D🎨";
    expect(normaliseGalleryTitle(title)).toEqual({ ok: true, value: title });
  });

  it("composes accents so one letter is stored one way", () => {
    expect(normaliseGalleryTitle("Café")).toEqual({
      ok: true,
      value: "Café",
    });
  });

  it("refuses an empty title", () => {
    expect(normaliseGalleryTitle(" \n\t ")).toEqual({
      ok: false,
      problem: "title_empty",
    });
  });

  it("accepts 120 characters and refuses 121, counting what people see", () => {
    expect(GALLERY_TEXT_LIMITS.titleMax).toBe(120);
    expect(normaliseGalleryTitle("a".repeat(120))).toMatchObject({ ok: true });
    expect(normaliseGalleryTitle("a".repeat(121))).toEqual({
      ok: false,
      problem: "title_too_long",
    });
    // 120 Devanagari syllables are far more than 120 code units.
    const syllable = "क्षि";
    expect(syllable.length).toBe(4);
    expect(normaliseGalleryTitle(syllable.repeat(120))).toMatchObject({
      ok: true,
    });
  });
});

describe("gallery story", () => {
  it("may be empty", () => {
    expect(normaliseGalleryStory("   ")).toEqual({ ok: true, value: "" });
  });

  it("keeps paragraphs but at most one blank line between them", () => {
    expect(
      normaliseGalleryStory("  First  line \r\nsecond\r\n\r\n\r\n\n  Next  ")
    ).toEqual({ ok: true, value: "First line\nsecond\n\nNext" });
  });

  it("turns tabs into spaces and drops other control characters", () => {
    expect(normaliseGalleryStory("A\tb\u0007c\u0085d")).toEqual({
      ok: true,
      value: "A bcd",
    });
  });

  it("accepts 500 characters and refuses 501", () => {
    expect(GALLERY_TEXT_LIMITS.storyMax).toBe(500);
    expect(normaliseGalleryStory("b".repeat(500))).toMatchObject({ ok: true });
    expect(normaliseGalleryStory("b".repeat(501))).toEqual({
      ok: false,
      problem: "story_too_long",
    });
  });

  it("counts the limit after normalising", () => {
    expect(normaliseGalleryStory(`${"b".repeat(500)}\n\n\n\n   `)).toEqual({
      ok: true,
      value: "b".repeat(500),
    });
  });
});

describe("graphemeCount", () => {
  it("counts user-perceived characters", () => {
    expect(graphemeCount("")).toBe(0);
    expect(graphemeCount("abc")).toBe(3);
    expect(graphemeCount("👩\u200D🎨")).toBe(1);
    expect(graphemeCount("नमस्ते")).toBe(3);
  });
});
