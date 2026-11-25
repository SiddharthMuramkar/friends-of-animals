import { describe, expect, it } from "vitest";

import {
  blindMediaFilename,
  planJudgingMedia,
  type JudgingDerivative,
} from "./judging-media";

const derivative = (
  kind: string,
  overrides: Partial<JudgingDerivative> = {}
): JudgingDerivative => ({
  kind,
  bucket: "test",
  storageKey: `pr-12/entry_image/01938a00-0000-7000-8000-0000000000${kind.length}`,
  contentType: "image/webp",
  width: 1600,
  height: 1200,
  durationMs: null,
  ...overrides,
});

describe("planJudgingMedia", () => {
  it("shows an image from its display copy, with the small copy for lists", () => {
    const display = derivative("display_1600");
    const thumbnail = derivative("thumb_320", { width: 320, height: 240 });
    expect(
      planJudgingMedia({ kind: "image", derivatives: [thumbnail, display] })
    ).toEqual({ kind: "image", display, thumbnail });
  });

  it("still shows an image that has no small copy", () => {
    const display = derivative("display_1600");
    expect(planJudgingMedia({ kind: "image", derivatives: [display] })).toEqual(
      { kind: "image", display, thumbnail: null }
    );
  });

  it("plays a video from its transcoded copy with the poster", () => {
    const video = derivative("video_mp4", {
      contentType: "video/mp4",
      durationMs: 95_000,
    });
    const poster = derivative("video_poster");
    expect(
      planJudgingMedia({ kind: "video", derivatives: [poster, video] })
    ).toEqual({ kind: "video", video, poster });
  });

  it("shows a typed essay as the sanitised text", () => {
    expect(
      planJudgingMedia({
        kind: "text",
        text: "Tigers need forests.",
      })
    ).toEqual({ kind: "essay_text", text: "Tigers need forests." });
  });

  it("shows an essay document from its cleaned PDF", () => {
    const pdf = derivative("pdf_clean", {
      contentType: "application/pdf",
      width: null,
      height: null,
    });
    expect(planJudgingMedia({ kind: "document", derivatives: [pdf] })).toEqual({
      kind: "document",
      document: pdf,
    });
  });

  it.each([
    ["an image with only a list-size copy", "image", ["thumb_320"]],
    ["a video with only a poster", "video", ["video_poster"]],
    ["a video still being transcoded", "video", []],
    ["a document not yet cleaned", "document", []],
    [
      "an image with derivatives of other kinds",
      "image",
      ["video_mp4", "pdf_clean"],
    ],
  ] as const)(
    "marks %s unavailable instead of falling back",
    (_name, kind, kinds) => {
      expect(
        planJudgingMedia({ kind, derivatives: kinds.map((k) => derivative(k)) })
      ).toEqual({ kind: "unavailable" });
    }
  );

  it("marks a typed essay with no saved text unavailable", () => {
    expect(planJudgingMedia({ kind: "text", text: null })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("blindMediaFilename", () => {
  it.each([
    ["image/webp", 1, "work-1.webp"],
    ["image/jpeg", 2, "work-2.jpg"],
    ["image/png", 1, "work-1.png"],
    ["image/avif", 1, "work-1.avif"],
    ["video/mp4", 1, "work-1.mp4"],
    ["application/pdf", 3, "work-3.pdf"],
    ["application/octet-stream", 1, "work-1.bin"],
  ])("names %s number %i %s", (contentType, position, expected) => {
    expect(blindMediaFilename(contentType, position)).toBe(expected);
  });

  it("refuses a position that isn't a whole number from 1", () => {
    expect(() => blindMediaFilename("image/webp", 0)).toThrow(RangeError);
    expect(() => blindMediaFilename("image/webp", 1.5)).toThrow(RangeError);
  });
});
