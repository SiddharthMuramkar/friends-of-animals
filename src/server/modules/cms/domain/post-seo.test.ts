import { describe, expect, it } from "vitest";

import { DEFAULT_SOCIAL_IMAGE } from "@/lib/seo";

import {
  blogPostingJsonLd,
  postBreadcrumbJsonLd,
  postMetadata,
} from "./post-seo";
import type { PostView } from "./post-view";

const BASE = new URL("https://foa.example");

const COVER = {
  source: "public",
  url: "https://media.foa.example/public/cms_image/0190a1b2-0000-7000-8000-000000000001/post_cover_1200.webp",
  width: 1200,
  height: 800,
  alt: "Volunteers untangle kite string from a pigeon's wing",
} as const;

const POST: PostView = {
  slug: "kinder-skies-in-kite-season",
  kind: "story",
  title: "Kinder skies in kite season",
  seoTitle: null,
  excerpt:
    "In January 2026, Gujarat ran over 1,000 bird-care points for kite season. In Delhi, a bird hospital open since 1929 treats its patients free.",
  audience: "families",
  topics: ["festivals", "birds"],
  featured: false,
  readingMinutes: 4,
  cover: COVER,
  publishedAt: new Date("2026-11-17T18:30:00.000Z"),
  updatedAt: new Date("2026-11-20T09:15:00.000Z"),
  easyRead: "Kites are fun, but string can hurt birds.",
  authorName: null,
  body: {
    blocks: [
      { type: "paragraph", text: ["Kites fill the sky.", { fn: "f1" }] },
      { type: "paragraph", text: ["Birds need care.", { fn: "f2" }] },
    ],
    footnotes: [
      {
        id: "f1",
        text: "Gujarat Forest Department, “Karuna Abhiyan 2026”",
        url: "https://forests.gujarat.gov.in/karuna",
      },
      {
        id: "f2",
        text: "Charity Birds Hospital, Delhi",
        url: "https://charitybirdshospital.org/",
      },
    ],
  },
};

describe("blogPostingJsonLd", () => {
  it("describes the post as a BlogPosting with absolute URLs", () => {
    expect(blogPostingJsonLd(POST, BASE)).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "Kinder skies in kite season",
      description: POST.excerpt,
      datePublished: "2026-11-17T18:30:00.000Z",
      dateModified: "2026-11-20T09:15:00.000Z",
      inLanguage: "en-IN",
      mainEntityOfPage: "https://foa.example/blog/kinder-skies-in-kite-season",
      url: "https://foa.example/blog/kinder-skies-in-kite-season",
      image: COVER.url,
      keywords: "festivals, birds",
      author: { "@type": "Organization", name: "Friends of Animals" },
      publisher: {
        "@type": "Organization",
        name: "Friends of Animals",
        logo: "https://foa.example/brand/foa-logo.svg",
      },
      citation: [
        "https://forests.gujarat.gov.in/karuna",
        "https://charitybirdshospital.org/",
      ],
    });
  });

  it("names a named author as a Person", () => {
    const ld = blogPostingJsonLd({ ...POST, authorName: "Asha Rao" }, BASE);
    expect(ld.author).toEqual({ "@type": "Person", name: "Asha Rao" });
  });

  it("uses the image the page resolved for a site photo cover", () => {
    const post: PostView = {
      ...POST,
      cover: { source: "site", id: "se-kites-uttarayan" },
    };
    expect(
      blogPostingJsonLd(post, BASE, {
        siteImageSrc: "/_next/static/media/se-kites-uttarayan.0a1b2c.jpg",
      }).image
    ).toBe("https://foa.example/_next/static/media/se-kites-uttarayan.0a1b2c.jpg");
  });

  it("falls back to the site's social card without a cover", () => {
    expect(blogPostingJsonLd({ ...POST, cover: null }, BASE).image).toBe(
      "https://foa.example/brand/foa-social-1200x630.png"
    );
  });

  it("headlines the full title even when a shorter search title exists", () => {
    const ld = blogPostingJsonLd({ ...POST, seoTitle: "Kinder skies" }, BASE);
    expect(ld.headline).toBe("Kinder skies in kite season");
  });
});

describe("postBreadcrumbJsonLd", () => {
  it("leads from home through the index to the post", () => {
    expect(
      postBreadcrumbJsonLd(POST, BASE, { home: "Home", index: "All stories" })
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://foa.example/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "All stories",
          item: "https://foa.example/blog",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Kinder skies in kite season",
          item: "https://foa.example/blog/kinder-skies-in-kite-season",
        },
      ],
    });
  });
});

describe("postMetadata", () => {
  it("sets the title, a whole-sentence description and the canonical path", () => {
    const meta = postMetadata(POST);
    expect(meta.title).toBe("Kinder skies in kite season");
    // 141 characters of the 160 allowed: both sentences fit.
    expect(meta.description).toBe(POST.excerpt);
    expect(meta.alternates?.canonical).toBe("/blog/kinder-skies-in-kite-season");
  });

  it("prefers the search title and cuts a long excerpt at a sentence", () => {
    const meta = postMetadata({
      ...POST,
      seoTitle: "Kinder skies",
      excerpt: `${"A short first sentence. "}${"b".repeat(150)}.`,
    });
    expect(meta.title).toBe("Kinder skies");
    expect(meta.description).toBe("A short first sentence.");
  });

  it("shares the uploaded cover's public derivative, with its size and alt", () => {
    const meta = postMetadata(POST);
    const image = {
      url: COVER.url,
      width: 1200,
      height: 800,
      alt: COVER.alt,
    };
    expect(meta.openGraph).toMatchObject({
      type: "article",
      url: "/blog/kinder-skies-in-kite-season",
      publishedTime: "2026-11-17T18:30:00.000Z",
      modifiedTime: "2026-11-20T09:15:00.000Z",
      images: [image],
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: [image],
    });
  });

  it("shares the site's social card when the cover is a site photo or absent", () => {
    for (const cover of [
      { source: "site", id: "se-kites-uttarayan" } as const,
      null,
    ]) {
      const meta = postMetadata({ ...POST, cover });
      expect(meta.openGraph).toMatchObject({ images: [DEFAULT_SOCIAL_IMAGE] });
      expect(meta.twitter).toMatchObject({ images: [DEFAULT_SOCIAL_IMAGE] });
    }
  });
});
