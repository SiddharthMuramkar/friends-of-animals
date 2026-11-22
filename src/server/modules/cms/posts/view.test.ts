import { describe, expect, it } from "vitest";

import type { PostBody } from "@/server/rich-text/post-body";

import { postBodyView, type PublicPostImage } from "./view";

const COVER_ID = "0190a1b2-0000-7000-8000-00000000000a";
const PENDING_ID = "0190a1b2-0000-7000-8000-00000000000b";

const PUBLIC: PublicPostImage = {
  source: "public",
  url: "https://media.foa.example/public/cms_image/0190a1b2-0000-7000-8000-0000000000f1/post_inline_960.webp",
  width: 960,
  height: 640,
  alt: "A pigeon resting on a balcony rail",
};

const BODY: PostBody = {
  blocks: [
    { type: "heading", level: 2, text: "Why string hurts" },
    { type: "paragraph", text: ["Kites fill the sky.", { fn: "f1" }] },
    { type: "image", postImageId: COVER_ID, caption: "At a care point" },
    { type: "image", siteImageId: "se-kites-uttarayan" },
    { type: "image", postImageId: PENDING_ID },
  ],
  footnotes: [
    { id: "f1", text: "Gujarat Forest Department", url: "https://example.org" },
  ],
};

describe("postBodyView", () => {
  it("shows an uploaded image by its public copy and a site photo by its id", () => {
    const view = postBodyView(BODY, new Map([[COVER_ID, PUBLIC]]));
    expect(view.blocks.filter((b) => b.type === "image")).toEqual([
      { type: "image", image: PUBLIC, caption: "At a care point" },
      { type: "image", image: { source: "site", id: "se-kites-uttarayan" } },
    ]);
  });

  it("leaves out an uploaded image that has no public copy", () => {
    const view = postBodyView(BODY, new Map([[COVER_ID, PUBLIC]]));
    expect(JSON.stringify(view)).not.toContain(PENDING_ID);
    expect(view.blocks).toHaveLength(4);
  });

  it("keeps text blocks and sources as they are", () => {
    const view = postBodyView(BODY, new Map());
    expect(view.blocks.slice(0, 2)).toEqual(BODY.blocks.slice(0, 2));
    expect(view.footnotes).toEqual(BODY.footnotes);
  });
});
