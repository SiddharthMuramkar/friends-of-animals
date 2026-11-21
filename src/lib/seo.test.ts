import { describe, expect, it } from "vitest";

import { SAMPLE_COMPETITIONS } from "@/content/sample";
import { STORIES } from "@/content/stories";
import { metaDescription } from "@/content/stories/text";
import { messages } from "@/i18n/messages";

import {
  breadcrumbJsonLd,
  DESCRIPTION_MAX,
  jsonLdScript,
  organizationJsonLd,
  pageMetadata,
  renderedTitle,
  TITLE_MAX,
} from "./seo";
import { SITE } from "./site";

/** Characters as people see them (graphemes), not UTF-16 code units. */
const graphemes = new Intl.Segmenter("en-IN", { granularity: "grapheme" });
const chars = (s: string) => [...graphemes.segment(s)].length;

describe("pageMetadata()", () => {
  const meta = pageMetadata({
    title: "About us",
    description: "Who we are.",
    path: "/about",
  });

  it("sets the title, description and canonical path", () => {
    expect(meta.title).toBe("About us");
    expect(meta.description).toBe("Who we are.");
    expect(meta.alternates?.canonical).toBe("/about");
  });

  it("fills Open Graph and Twitter with the default social image", () => {
    expect(meta.openGraph).toMatchObject({
      title: "About us",
      description: "Who we are.",
      url: "/about",
    });
    const images = meta.openGraph?.images;
    expect(JSON.stringify(images)).toContain("/brand/foa-social-1200x630.png");
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("uses a page image when given", () => {
    const withImage = pageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      image: { url: "/x.jpg", width: 1200, height: 630, alt: "A kite" },
    });
    expect(JSON.stringify(withImage.openGraph?.images)).toContain("/x.jpg");
  });
});

describe("jsonLdScript()", () => {
  it("escapes < so the script tag can't be closed early", () => {
    const out = jsonLdScript({ name: "</script><b>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ name: "</script><b>" });
  });
});

describe("organizationJsonLd()", () => {
  const data = organizationJsonLd(
    new URL("https://friendsofanimals.dev"),
    "About."
  );

  it("describes FOA as an NGO with absolute URLs", () => {
    expect(data).toMatchObject({
      "@type": "NGO",
      name: "Friends of Animals",
      url: "https://friendsofanimals.dev/",
      logo: "https://friendsofanimals.dev/brand/foa-logo.svg",
    });
  });

  it("omits facts that are still placeholders", () => {
    expect(data).not.toHaveProperty("email");
    expect(data).not.toHaveProperty("legalName");
    expect(JSON.stringify(data)).not.toContain("placeholder");
  });
});

describe("breadcrumbJsonLd()", () => {
  it("numbers the crumbs from 1 with absolute URLs", () => {
    const data = breadcrumbJsonLd(new URL("https://friendsofanimals.dev"), [
      { name: "Competitions", path: "/competitions" },
      { name: "Kinder Skies", path: "/competitions/kinder-skies" },
    ]);
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Competitions",
        item: "https://friendsofanimals.dev/competitions",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Kinder Skies",
        item: "https://friendsofanimals.dev/competitions/kinder-skies",
      },
    ]);
  });
});

describe("renderedTitle()", () => {
  it("adds the site name unless the title is absolute", () => {
    expect(renderedTitle("About us")).toBe("About us · Friends of Animals");
    expect(renderedTitle("Friends of Animals", true)).toBe(
      "Friends of Animals"
    );
  });
});

type Meta = { title?: string; description?: string };

/** Every `meta` block in the messages, by dotted path ("legal.terms.meta"). */
function metaBlocks(tree: object, path = ""): [string, Meta][] {
  return Object.entries(tree).flatMap(([key, value]): [string, Meta][] => {
    if (typeof value !== "object" || value === null) return [];
    const here = path ? `${path}.${key}` : key;
    return key === "meta" ? [[here, value as Meta]] : metaBlocks(value, here);
  });
}

// Pages that pass absoluteTitle to pageMetadata (no site-name suffix).
const ABSOLUTE = new Set(["home.meta"]);

describe("page titles (≤ 60) and descriptions (≤ 160)", () => {
  const blocks = metaBlocks(messages);

  it("finds every page's meta messages", () => {
    const paths = blocks.map(([path]) => path);
    expect(paths).toContain("home.meta");
    expect(paths).toContain("legal.privacy.meta");
    expect(blocks.length).toBeGreaterThanOrEqual(18);
  });

  it("keeps every route's title and description within the limits", () => {
    for (const [path, { title, description }] of blocks) {
      if (title !== undefined)
        expect(
          chars(renderedTitle(title, ABSOLUTE.has(path))),
          path
        ).toBeLessThanOrEqual(TITLE_MAX);
      if (description !== undefined)
        expect(chars(description), path).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("keeps the site-wide default within the limits", () => {
    expect(chars(SITE.name)).toBeLessThanOrEqual(TITLE_MAX);
    expect(chars(messages.common.tagline)).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("keeps every story's title, with the suffix, and description within", () => {
    for (const story of STORIES) {
      expect(
        chars(renderedTitle(story.seoTitle ?? story.title)),
        story.slug
      ).toBeLessThanOrEqual(TITLE_MAX);
      expect(chars(metaDescription(story.dek)), story.slug).toBeLessThanOrEqual(
        DESCRIPTION_MAX
      );
    }
  });

  it("keeps every sample competition page within the limits", () => {
    for (const c of SAMPLE_COMPETITIONS) {
      expect(chars(renderedTitle(c.name)), c.slug).toBeLessThanOrEqual(
        TITLE_MAX
      );
      expect(chars(c.theme), c.slug).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });
});
