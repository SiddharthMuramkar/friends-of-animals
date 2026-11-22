import { describe, expect, it } from "vitest";

import { previewBody } from "./preview";

const IMAGE = "01938a00-1234-7abc-8def-0123456789ab";

describe("previewBody", () => {
  it("shows a site photo as the stories do, and an uploaded image by its alt text", () => {
    const body = previewBody(
      {
        blocks: [
          { type: "paragraph", text: ["Birds first."] },
          {
            type: "image",
            siteImageId: "dog-bengaluru-auto-rickshaw",
            caption: "A dog",
          },
          { type: "image", postImageId: IMAGE, caption: "Volunteers" },
        ],
        footnotes: [],
      },
      [{ id: IMAGE, fileId: IMAGE, alt: "A kite", ready: false }],
      {
        image: "Image",
        ready: (alt) => `${alt} (ready)`,
        notReady: (alt) => `${alt} (being prepared)`,
        noAlt: "No alt text yet",
      }
    );

    expect(body.blocks).toEqual([
      { type: "paragraph", text: ["Birds first."] },
      {
        type: "image",
        imageId: "dog-bengaluru-auto-rickshaw",
        caption: "A dog",
      },
      {
        type: "callout",
        tone: "info",
        title: "Image",
        body: [["A kite (being prepared)"], ["Volunteers"]],
      },
    ]);
  });

  it("says when an uploaded image has no alt text yet", () => {
    const body = previewBody(
      { blocks: [{ type: "image", postImageId: IMAGE }], footnotes: [] },
      [{ id: IMAGE, fileId: IMAGE, alt: "", ready: true }],
      {
        image: "Image",
        ready: (alt) => `${alt} (ready)`,
        notReady: (alt) => `${alt} (being prepared)`,
        noAlt: "No alt text yet",
      }
    );

    expect(body.blocks).toEqual([
      {
        type: "callout",
        tone: "info",
        title: "Image",
        body: [["No alt text yet (ready)"]],
      },
    ]);
  });
});
