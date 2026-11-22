import { describe, expect, it } from "vitest";

import { STORIES } from "@/content/stories";

import { checkPostFields, postMetaTitle, type PostFields } from "./post-fields";

const VALID: PostFields = {
  title: "Kinder skies in kite season",
  excerpt: "Gujarat ran over 1,000 bird-care points for kite season.",
};

describe("checkPostFields", () => {
  it("accepts every story already on the site, so imports need no edits", () => {
    for (const story of STORIES) {
      const fields: PostFields = {
        title: story.title,
        seoTitle: story.seoTitle,
        excerpt: story.dek,
        easyRead: story.easyRead,
      };
      expect(checkPostFields(fields), story.slug).toEqual({ ok: true });
    }
  });

  it("accepts the smallest valid post", () => {
    expect(checkPostFields(VALID)).toEqual({ ok: true });
  });

  it("requires a title and an excerpt that aren't blank", () => {
    expect(checkPostFields({ title: "  ", excerpt: "" })).toEqual({
      ok: false,
      errors: { title: "required", excerpt: "required" },
    });
  });

  it("caps each field's length", () => {
    expect(
      checkPostFields({
        title: "t".repeat(81),
        seoTitle: "s".repeat(40),
        excerpt: "e".repeat(301),
        easyRead: "r".repeat(201),
        authorName: "a".repeat(81),
        cover: { alt: "c".repeat(201) },
      })
    ).toEqual({
      ok: false,
      errors: {
        title: "too_long",
        seoTitle: "too_long",
        excerpt: "too_long",
        easyRead: "too_long",
        authorName: "too_long",
        coverAlt: "too_long",
      },
    });
  });

  it("accepts each field at its maximum", () => {
    expect(
      checkPostFields({
        title: "t".repeat(80),
        seoTitle: "s".repeat(39),
        excerpt: "e".repeat(300),
        easyRead: "r".repeat(200),
        authorName: "a".repeat(80),
        cover: { alt: "c".repeat(200) },
      })
    ).toEqual({ ok: true });
  });

  it("needs a search title when the title is too long for the browser tab", () => {
    // 40 characters + " · Friends of Animals" is 61, one past the limit.
    const title = "t".repeat(40);
    expect(checkPostFields({ ...VALID, title })).toEqual({
      ok: false,
      errors: { seoTitle: "required" },
    });
    expect(checkPostFields({ ...VALID, title: "t".repeat(39) })).toEqual({
      ok: true,
    });
    expect(
      checkPostFields({ ...VALID, title, seoTitle: "Shorter title" })
    ).toEqual({ ok: true });
  });

  it("needs alt text for a cover image", () => {
    expect(checkPostFields({ ...VALID, cover: { alt: " " } })).toEqual({
      ok: false,
      errors: { coverAlt: "required" },
    });
    expect(
      checkPostFields({ ...VALID, cover: { alt: "A kite over a rooftop" } })
    ).toEqual({ ok: true });
  });

  it("lets a draft leave what only going live needs for later", () => {
    const draft = {
      title: "t".repeat(40),
      excerpt: " ",
      cover: { alt: "" },
    };
    expect(checkPostFields(draft, { draft: true })).toEqual({ ok: true });
    expect(checkPostFields(draft)).toEqual({
      ok: false,
      errors: {
        excerpt: "required",
        coverAlt: "required",
        seoTitle: "required",
      },
    });
  });

  it("still needs a draft's title, and caps every field of a draft", () => {
    expect(
      checkPostFields(
        {
          title: "",
          excerpt: "e".repeat(301),
          seoTitle: "s".repeat(40),
          cover: { alt: "c".repeat(201) },
        },
        { draft: true }
      )
    ).toEqual({
      ok: false,
      errors: {
        title: "required",
        excerpt: "too_long",
        coverAlt: "too_long",
        seoTitle: "too_long",
      },
    });
  });
});

describe("postMetaTitle", () => {
  it("uses the title when it fits and the search title when it doesn't", () => {
    expect(postMetaTitle({ title: "Short title" })).toBe("Short title");
    expect(
      postMetaTitle({ title: "Short title", seoTitle: "Even shorter" })
    ).toBe("Even shorter");
    expect(
      postMetaTitle({
        title: "Two pilots, two puppies and the start of Blue Cross",
        seoTitle: "Two pilots, two puppies and Blue Cross",
      })
    ).toBe("Two pilots, two puppies and Blue Cross");
  });

  it("trims what it returns", () => {
    expect(postMetaTitle({ title: "  Spaced title  " })).toBe("Spaced title");
    expect(postMetaTitle({ title: "Title", seoTitle: "   " })).toBe("Title");
  });
});
