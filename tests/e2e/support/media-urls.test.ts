import { describe, expect, it } from "vitest";

import {
  auditMediaRefs,
  classifyMediaUrl,
  cssUrls,
  originalProbeUrls,
  parseSrcset,
  publicRoots,
  storageKey,
  type MediaContext,
  type StampedMedia,
} from "./media-urls";

const SITE = "https://friends-of-animals-git-x-acme-ef4b.vercel.app";
const CANONICAL = "https://shipped-it.dev";
const CDN = "https://media.example.org";
const ID = "0193a2b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b";
const OTHER_ID = "0193a2b4-5c6d-7e8f-9a0b-ffffffffffff";

const ctx: MediaContext = { origins: [SITE, CANONICAL] };

describe("parseSrcset", () => {
  it.each([
    ["width descriptors", "a.jpg 480w, b.jpg 2048w", ["a.jpg", "b.jpg"]],
    ["density descriptors", "a.jpg 1x, b.jpg 2x", ["a.jpg", "b.jpg"]],
    ["no descriptor", "a.jpg", ["a.jpg"]],
    [
      "extra spaces and line breaks",
      "  a.jpg   480w ,\n\t b.jpg 2048w  ",
      ["a.jpg", "b.jpg"],
    ],
    ["empty candidates", "a.jpg,, ,b.jpg 2x", ["a.jpg", "b.jpg"]],
    [
      "a comma inside a data URI",
      "data:image/png;base64,iVBORw0KGgo= 1x, b.jpg 2x",
      ["data:image/png;base64,iVBORw0KGgo=", "b.jpg"],
    ],
    [
      "a comma inside parenthesised descriptors",
      "a.jpg size(1, 2) 1x, b.jpg",
      ["a.jpg", "b.jpg"],
    ],
    [
      "absolute URLs with query strings",
      `${CDN}/pr-12/stamped_gallery_thumb/${ID}?v=1 480w, /_next/image?url=%2Fx.jpg&w=640 640w`,
      [
        `${CDN}/pr-12/stamped_gallery_thumb/${ID}?v=1`,
        "/_next/image?url=%2Fx.jpg&w=640",
      ],
    ],
    ["an empty attribute", "   ", []],
  ])("reads %s", (_, srcset, urls) => {
    expect(parseSrcset(srcset)).toEqual(urls);
  });
});

describe("cssUrls", () => {
  it("reads quoted and unquoted url() references", () => {
    expect(
      cssUrls(
        `background-image: url("a.jpg"), url( 'b.jpg' ); mask: URL(c.jpg)`
      )
    ).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("finds nothing in a style without url()", () => {
    expect(cssUrls("color: red; aspect-ratio: 4 / 3")).toEqual([]);
  });
});

describe("storageKey", () => {
  it("follows the Files layout <prefix><purpose>/<fileId>", () => {
    expect(storageKey("pr-12/", "entry_image", ID)).toBe(
      `pr-12/entry_image/${ID}`
    );
    expect(storageKey("", "entry_image", ID)).toBe(`entry_image/${ID}`);
  });
});

describe("classifyMediaUrl", () => {
  it.each([
    ["a hashed site photo", "/_next/static/media/dog.3f2a1b.jpg"],
    ["a script chunk", `${SITE}/_next/static/chunks/main.js`],
    ["a brand file", "/brand/foa-logo-512.png"],
    ["the favicon", "/favicon.ico"],
    ["a brand file on the canonical origin", `${CANONICAL}/brand/foa-logo.png`],
    [
      "next/image of a site photo",
      "/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Fdog.3f2a1b.jpg&w=640&q=75",
    ],
  ])("treats %s as a site asset", (_, url) => {
    expect(classifyMediaUrl(url, ctx)).toEqual({ kind: "site" });
  });

  it.each([
    [
      "the fallback route with a preview prefix",
      `/media/p/pr-12/stamped_gallery/${ID}`,
      { via: "fallback", root: `${SITE}/media/p`, prefix: "pr-12/" },
    ],
    [
      "the fallback route with no prefix",
      `/media/p/stamped_gallery/${ID}`,
      { via: "fallback", root: `${SITE}/media/p`, prefix: "" },
    ],
    [
      "the fallback route on the canonical origin",
      `${CANONICAL}/media/p/staging/stamped_gallery/${ID}`,
      { via: "fallback", root: `${CANONICAL}/media/p`, prefix: "staging/" },
    ],
    [
      "the CDN with a preview prefix",
      `${CDN}/pr-12/stamped_gallery/${ID}`,
      { via: "cdn", root: CDN, prefix: "pr-12/" },
    ],
    [
      "the CDN with a branch prefix",
      `${CDN}/br-1a2b3c4d/stamped_gallery/${ID}`,
      { via: "cdn", root: CDN, prefix: "br-1a2b3c4d/" },
    ],
    [
      "the CDN under a base path, with no prefix (production)",
      `${CDN}/assets/stamped_gallery/${ID}`,
      { via: "cdn", root: `${CDN}/assets`, prefix: "" },
    ],
    [
      "the CDN under a base path, with a prefix",
      `${CDN}/assets/staging/stamped_gallery/${ID}`,
      { via: "cdn", root: `${CDN}/assets`, prefix: "staging/" },
    ],
  ])("treats %s as stamped", (_, url, expected) => {
    expect(classifyMediaUrl(url, ctx)).toEqual({
      kind: "stamped",
      purpose: "stamped_gallery",
      fileId: ID,
      ...expected,
    });
  });

  it.each([
    ["the private file route", `/api/files/${ID}`, "files_api"],
    [
      "a signed storage URL",
      `https://files.example.org/pr-12/stamped_gallery/${ID}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc`,
      "signed_url",
    ],
    [
      "a signed URL in lower case",
      `${CDN}/x.jpg?x-amz-credential=abc`,
      "signed_url",
    ],
    [
      "the R2 S3 endpoint",
      `https://acct.r2.cloudflarestorage.com/foa-public/pr-12/stamped_gallery/${ID}`,
      "storage_api",
    ],
    [
      "an original on the CDN",
      `${CDN}/pr-12/entry_image/${ID}`,
      "original_key",
    ],
    [
      "an original on the CDN with an upper-case id",
      `${CDN}/entry_image/${ID.toUpperCase()}`,
      "original_key",
    ],
    [
      "an original on the fallback route",
      `/media/p/pr-12/entry_image/${ID}`,
      "original_key",
    ],
    [
      "a private derivative on the fallback route",
      `/media/p/derived_image/${ID}`,
      "original_key",
    ],
    [
      "an original key on another site route",
      `/files/pr-12/entry_image/${ID}`,
      "original_key",
    ],
    [
      "next/image wrapping an original",
      `/_next/image?url=${encodeURIComponent(`${CDN}/pr-12/entry_image/${ID}`)}&w=640&q=75`,
      "original_key",
    ],
  ])("treats %s as private", (_, url, why) => {
    expect(classifyMediaUrl(url, ctx)).toEqual({ kind: "private", why });
  });

  it.each([
    ["an image on another host", "https://images.example.net/cat.jpg"],
    ["an image on another site path", "/uploads/cat.jpg"],
    [
      "a stamped key outside the fallback route",
      `/pr-12/stamped_gallery/${ID}`,
    ],
    ["another media route", `/media/x/stamped_gallery/${ID}`],
    ["an unknown prefix", `/media/p/local/stamped_gallery/${ID}`],
    ["a file id that is not a UUID", "/media/p/pr-12/stamped_gallery/12345"],
    ["a key with an extension", `/media/p/stamped_gallery/${ID}.jpg`],
    [
      "an encoded slash",
      `/media/p/pr-12%2Fstamped_gallery%2F${encodeURIComponent(ID)}`,
    ],
    ["next/image with no url", "/_next/image?w=640"],
    [
      "next/image wrapping next/image",
      `/_next/image?url=${encodeURIComponent("/_next/image?url=%2Fx.jpg")}`,
    ],
  ])("treats %s as unknown", (_, url) => {
    expect(classifyMediaUrl(url, ctx)).toEqual({ kind: "unknown" });
  });

  it.each([
    ["a site page", "/gallery/FOA-2026-0042", "page"],
    ["a results page", `${SITE}/competitions/spring-2026/results`, "page"],
    ["a certificate check page", `/verify/${ID}`, "page"],
    ["the home page", CANONICAL, "page"],
    ["another site", "https://www.instagram.com/foa", "external"],
    ["an email link", "mailto:hello@example.org", "external"],
    ["an inline image", "data:image/png;base64,iVBORw0KGgo=", "inline"],
  ])("treats %s as %s", (_, url, kind) => {
    expect(classifyMediaUrl(url, ctx)).toEqual({ kind });
  });

  it("resolves `..` before classifying", () => {
    expect(classifyMediaUrl(`/media/p/../../api/files/${ID}`, ctx)).toEqual({
      kind: "private",
      why: "files_api",
    });
  });
});

describe("auditMediaRefs", () => {
  const page = "/gallery/FOA-2026-0042";

  it("passes stamped and site images and page links, and lists the stamped ones", () => {
    const result = auditMediaRefs(
      [
        {
          page,
          source: "img-src",
          url: `/media/p/pr-12/stamped_gallery/${ID}`,
        },
        { page, source: "img-srcset", url: "/_next/static/media/dog.jpg" },
        { page, source: "og:image", url: `${CANONICAL}/brand/foa-logo.png` },
        { page, source: "style-url", url: "data:image/png;base64,AAAA" },
        { page, source: "a-href", url: "/gallery" },
        { page, source: "a-href", url: "https://www.instagram.com/foa" },
      ],
      ctx
    );
    expect(result.violations).toEqual([]);
    expect(result.stamped).toEqual([
      {
        page,
        source: "img-src",
        url: `/media/p/pr-12/stamped_gallery/${ID}`,
        media: {
          kind: "stamped",
          via: "fallback",
          root: `${SITE}/media/p`,
          prefix: "pr-12/",
          purpose: "stamped_gallery",
          fileId: ID,
        },
      },
    ]);
  });

  it("flags private and unknown media wherever it appears", () => {
    const refs = [
      { page, source: "img-src", url: `${CDN}/pr-12/entry_image/${ID}` },
      { page, source: "a-href", url: `/api/files/${ID}` },
      { page, source: "a-href", url: "https://images.example.net/cat.jpg" },
      { page, source: "twitter:image", url: "https://www.instagram.com/foa" },
      { page, source: "source-srcset", url: "/gallery" },
    ] as const;
    expect(auditMediaRefs(refs, ctx).violations).toEqual([
      { ...refs[0], media: { kind: "private", why: "original_key" } },
      { ...refs[1], media: { kind: "private", why: "files_api" } },
      { ...refs[2], media: { kind: "unknown" } },
      { ...refs[3], media: { kind: "external" } },
      { ...refs[4], media: { kind: "page" } },
    ]);
  });
});

function stamped(url: string): StampedMedia {
  const media = classifyMediaUrl(url, ctx);
  if (media.kind !== "stamped") throw new Error(`not stamped: ${url}`);
  return media;
}

describe("publicRoots", () => {
  it("probes the CDN root and the crawled site's fallback route", () => {
    expect(
      publicRoots(
        [
          stamped(`${CDN}/pr-12/stamped_gallery/${ID}`),
          stamped(`${CDN}/pr-12/stamped_gallery_thumb/${OTHER_ID}`),
        ],
        SITE
      )
    ).toEqual({ prefix: "pr-12/", roots: [CDN, `${SITE}/media/p`] });
  });

  it("probes the fallback route on the crawled origin, not the canonical one", () => {
    expect(
      publicRoots(
        [stamped(`${CANONICAL}/media/p/pr-12/stamped_gallery/${ID}`)],
        SITE
      )
    ).toEqual({ prefix: "pr-12/", roots: [`${SITE}/media/p`] });
  });

  it("fails an empty crawl", () => {
    expect(() => publicRoots([], SITE)).toThrow(/no stamped image/);
  });

  it("fails a crawl whose stamped URLs disagree on the prefix", () => {
    expect(() =>
      publicRoots(
        [
          stamped(`${CDN}/pr-12/stamped_gallery/${ID}`),
          stamped(`${CDN}/staging/stamped_gallery/${OTHER_ID}`),
        ],
        SITE
      )
    ).toThrow(/"pr-12\/" and "staging\/"/);
  });
});

describe("originalProbeUrls", () => {
  it("builds the original's key under every public root", () => {
    expect(
      originalProbeUrls(
        { prefix: "pr-12/", roots: [CDN, `${SITE}/media/p`] },
        { purpose: "entry_image", fileId: ID }
      )
    ).toEqual([
      `${CDN}/pr-12/entry_image/${ID}`,
      `${SITE}/media/p/pr-12/entry_image/${ID}`,
    ]);
  });

  it("builds a production key with no prefix", () => {
    expect(
      originalProbeUrls(
        { prefix: "", roots: [`${CDN}/assets`] },
        { purpose: "derived_image", fileId: ID }
      )
    ).toEqual([`${CDN}/assets/derived_image/${ID}`]);
  });

  it("refuses to probe a stamped purpose", () => {
    expect(() =>
      originalProbeUrls(
        { prefix: "", roots: [CDN] },
        { purpose: "stamped_gallery", fileId: ID }
      )
    ).toThrow(/stamped_gallery/);
  });
});
