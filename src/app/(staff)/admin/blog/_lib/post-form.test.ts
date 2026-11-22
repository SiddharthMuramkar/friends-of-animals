import { describe, expect, it } from "vitest";

import {
  afterSave,
  coverChoice,
  emptyPostForm,
  postFormOf,
  postInputOf,
  readPostForm,
} from "./post-form";

const IMAGE_ID = "01938a00-1234-7abc-8def-0123456789ab";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

const FILLED = {
  kind: "story",
  title: "Kinder skies",
  slug: "kinder-skies",
  excerpt: "Birds first.",
  seoTitle: "",
  easyRead: "Kites can hurt birds.",
  authorName: "Asha",
  audience: "families",
  topics: "kites, birds  street-dogs",
  featured: "on",
  cover: "site:dog-bengaluru-auto-rickshaw",
  source: "## Kite season\n\nBirds first.",
};

describe("postInputOf", () => {
  it("turns the form into the use case's input, the body parsed from its markup", () => {
    const values = readPostForm(form(FILLED));

    expect(postInputOf(values)).toEqual({
      ok: true,
      input: {
        kind: "story",
        title: "Kinder skies",
        slug: "kinder-skies",
        excerpt: "Birds first.",
        seoTitle: "",
        easyRead: "Kites can hurt birds.",
        authorName: "Asha",
        audience: "families",
        topics: ["kites", "birds", "street-dogs"],
        featured: true,
        cover: { siteImageId: "dog-bengaluru-auto-rickshaw" },
        body: {
          blocks: [
            { type: "heading", level: 2, text: "Kite season" },
            { type: "paragraph", text: ["Birds first."] },
          ],
          footnotes: [],
        },
      },
    });
  });

  it("names an uploaded cover by its id, and no cover by null", () => {
    const uploaded = postInputOf(
      readPostForm(form({ ...FILLED, cover: `post:${IMAGE_ID}` }))
    );
    const none = postInputOf(readPostForm(form({ ...FILLED, cover: "" })));

    expect(uploaded).toMatchObject({
      input: { cover: { postImageId: IMAGE_ID } },
    });
    expect(none).toMatchObject({ input: { cover: null } });
  });

  it("leaves an unticked box false and passes odd values on for the use case to refuse", () => {
    const values = readPostForm(
      form({ ...FILLED, featured: "", kind: "memo" })
    );
    delete (values as Partial<typeof values>).featured;

    expect(postInputOf({ ...values, featured: false })).toMatchObject({
      input: { kind: "memo", featured: false },
    });
  });

  it("returns the markup's errors, by line, instead of an input", () => {
    expect(
      postInputOf(
        readPostForm(form({ ...FILLED, source: "## Fine\n\n**open" }))
      )
    ).toEqual({
      ok: false,
      sourceErrors: [{ line: 3, code: "unclosed_strong" }],
    });
  });
});

describe("postFormOf and coverChoice", () => {
  it("prefills the form from a saved post, its body as markup", () => {
    const values = postFormOf({
      kind: "blog",
      title: "Kinder skies",
      slug: "kinder-skies",
      excerpt: "Birds first.",
      seoTitle: null,
      easyRead: null,
      authorName: null,
      audience: "everyone",
      topics: ["kites", "birds"],
      featured: false,
      cover: { postImageId: IMAGE_ID },
      body: {
        blocks: [{ type: "paragraph", text: ["Birds first."] }],
        footnotes: [],
      },
    });

    expect(values).toEqual({
      kind: "blog",
      title: "Kinder skies",
      slug: "kinder-skies",
      excerpt: "Birds first.",
      seoTitle: "",
      easyRead: "",
      authorName: "",
      audience: "everyone",
      topics: "kites, birds",
      featured: false,
      cover: `post:${IMAGE_ID}`,
      source: "Birds first.\n",
    });
    expect(coverChoice({ siteImageId: "dog-bengaluru-auto-rickshaw" })).toBe(
      "site:dog-bengaluru-auto-rickshaw"
    );
    expect(coverChoice(null)).toBe("");
    expect(emptyPostForm()).toMatchObject({ kind: "blog", source: "" });
  });
});

describe("afterSave", () => {
  const values = readPostForm(form(FILLED));

  it("marks each refused field", () => {
    expect(
      afterSave(
        {
          ok: false,
          error: "invalid_input",
          fields: ["slug", "excerpt"],
          errors: { slug: "taken", excerpt: "too_long" },
        },
        values,
        2
      )
    ).toEqual({
      attempt: 3,
      values,
      errors: { slug: "taken", excerpt: "too_long" },
      sourceErrors: [],
    });
  });

  it("says why the whole form was refused", () => {
    for (const [error, alert] of [
      ["unknown_image", "unknownImage"],
      ["image_not_ready", "imageNotReady"],
      ["archived", "archived"],
      ["not_found", "notFound"],
    ] as const) {
      expect(afterSave({ ok: false, error }, values, 0)).toMatchObject({
        attempt: 1,
        alert,
        errors: {},
      });
    }
  });
});
