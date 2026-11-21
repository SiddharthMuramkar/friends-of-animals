import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIDEO_RULE,
  VIDEO_TYPES,
  checkVideoUpload,
  videoAcceptAttribute,
  videoTypeOf,
} from "./video-upload";

const MB = 1024 * 1024;

const clip = (
  overrides: Partial<{
    name: string;
    type: string;
    size: number;
    durationMs: number | null;
  }> = {}
) => ({
  name: "IMG_0042.MOV",
  type: "video/quicktime",
  size: 48 * MB,
  durationMs: 40_000,
  ...overrides,
});

describe("DEFAULT_VIDEO_RULE", () => {
  it("takes common phone formats up to 200 MB and 3 minutes", () => {
    expect(DEFAULT_VIDEO_RULE).toEqual({
      acceptedTypes: VIDEO_TYPES,
      maxBytes: 200 * MB,
      maxDurationMs: 180_000,
    });
    expect(VIDEO_TYPES).toEqual([
      "video/mp4",
      "video/quicktime",
      "video/3gpp",
      "video/webm",
    ]);
  });
});

describe("videoTypeOf", () => {
  it("normalises the reported type", () => {
    expect(videoTypeOf({ name: "a.mp4", type: "Video/MP4; codecs=avc1" })).toBe(
      "video/mp4"
    );
    expect(videoTypeOf({ name: "a.m4v", type: "video/x-m4v" })).toBe(
      "video/mp4"
    );
  });

  it("goes by the extension when the reported type says nothing", () => {
    expect(videoTypeOf({ name: "IMG_0042.MOV", type: "" })).toBe(
      "video/quicktime"
    );
    expect(
      videoTypeOf({ name: "clip.3gp", type: "application/octet-stream" })
    ).toBe("video/3gpp");
    expect(videoTypeOf({ name: "clip.webm", type: "" })).toBe("video/webm");
    expect(videoTypeOf({ name: "clip.m4v", type: "" })).toBe("video/mp4");
    expect(videoTypeOf({ name: "notes.txt", type: "" })).toBeNull();
  });
});

describe("checkVideoUpload", () => {
  it("accepts a phone clip within the limits", () => {
    expect(checkVideoUpload(clip(), DEFAULT_VIDEO_RULE)).toEqual({
      ok: true,
      contentType: "video/quicktime",
    });
  });

  it("accepts a clip exactly at both limits", () => {
    expect(
      checkVideoUpload(
        clip({ size: 200 * MB, durationMs: 180_000 }),
        DEFAULT_VIDEO_RULE
      )
    ).toMatchObject({ ok: true });
  });

  it("refuses an empty file first", () => {
    expect(
      checkVideoUpload(
        clip({ size: 0, type: "text/plain" }),
        DEFAULT_VIDEO_RULE
      )
    ).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses formats phones don't record or browsers can't hand us", () => {
    for (const file of [
      clip({ name: "a.avi", type: "video/x-msvideo" }),
      clip({ name: "a.mkv", type: "video/x-matroska" }),
      clip({ name: "a.png", type: "image/png" }),
      clip({ name: "a.bin", type: "" }),
    ]) {
      expect(checkVideoUpload(file, DEFAULT_VIDEO_RULE)).toEqual({
        ok: false,
        reason: "wrong_type",
      });
    }
  });

  it("refuses a file one byte over the size limit", () => {
    expect(
      checkVideoUpload(clip({ size: 200 * MB + 1 }), DEFAULT_VIDEO_RULE)
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a clip over the length limit, with a second of slack", () => {
    expect(
      checkVideoUpload(clip({ durationMs: 181_000 }), DEFAULT_VIDEO_RULE)
    ).toMatchObject({ ok: true });
    expect(
      checkVideoUpload(clip({ durationMs: 181_001 }), DEFAULT_VIDEO_RULE)
    ).toEqual({ ok: false, reason: "too_long" });
  });

  it("lets the server decide when the browser can't read the length", () => {
    for (const durationMs of [null, undefined, Number.NaN, Infinity]) {
      expect(
        checkVideoUpload(clip({ durationMs }), DEFAULT_VIDEO_RULE)
      ).toMatchObject({ ok: true });
    }
  });

  it("checks against the competition's own rule", () => {
    const shortClips = {
      acceptedTypes: ["video/mp4"] as const,
      maxBytes: 50 * MB,
      maxDurationMs: 60_000,
    };
    expect(checkVideoUpload(clip(), shortClips)).toEqual({
      ok: false,
      reason: "wrong_type",
    });
    expect(
      checkVideoUpload(
        clip({ name: "a.mp4", type: "video/mp4", durationMs: 90_000 }),
        shortClips
      )
    ).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("videoAcceptAttribute", () => {
  it("lists the types, then their extensions", () => {
    expect(videoAcceptAttribute(DEFAULT_VIDEO_RULE)).toBe(
      "video/mp4,video/quicktime,video/3gpp,video/webm,.mp4,.m4v,.mov,.3gp,.webm"
    );
  });
});
