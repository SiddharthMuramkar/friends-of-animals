import { describe, expect, it } from "vitest";

import {
  acceptAttribute,
  checkUpload,
  DEFAULT_IMAGE_RULE,
  uploadTypeOf,
} from "./upload-rules";
import { DEFAULT_VIDEO_RULE } from "./video-upload";

const MB = 1024 * 1024;

describe("uploadTypeOf", () => {
  it("uses the type the browser reports, lower-cased and without parameters", () => {
    expect(uploadTypeOf({ name: "cat.png", type: "image/png" })).toBe(
      "image/png"
    );
    expect(uploadTypeOf({ name: "cat", type: "IMAGE/JPEG; charset=x" })).toBe(
      "image/jpeg"
    );
  });

  it("reads the old image/jpg alias as JPEG", () => {
    expect(uploadTypeOf({ name: "cat.jpg", type: "image/jpg" })).toBe(
      "image/jpeg"
    );
  });

  it("falls back to the extension when the browser reports no useful type", () => {
    for (const type of ["", "application/octet-stream"]) {
      expect(uploadTypeOf({ name: "IMG_0042.HEIC", type })).toBe("image/heic");
      expect(uploadTypeOf({ name: "scan.heif", type })).toBe("image/heif");
      expect(uploadTypeOf({ name: "drawing.JPEG", type })).toBe("image/jpeg");
      expect(uploadTypeOf({ name: "drawing.webp", type })).toBe("image/webp");
      expect(uploadTypeOf({ name: "no-extension", type })).toBeNull();
      expect(uploadTypeOf({ name: "notes.txt", type })).toBeNull();
    }
  });
});

describe("checkUpload with the default image rule", () => {
  it("accepts JPEG, PNG, WebP, HEIC and HEIF photos up to 20 MB", () => {
    for (const [name, type] of [
      ["a.jpg", "image/jpeg"],
      ["a.png", "image/png"],
      ["a.webp", "image/webp"],
      ["a.heic", "image/heic"],
      ["a.heif", "image/heif"],
      ["IMG_0042.HEIC", ""],
    ] as const) {
      expect(
        checkUpload({ name, type, size: 20 * MB }, DEFAULT_IMAGE_RULE)
      ).toEqual({ ok: true, contentType: type || "image/heic" });
    }
  });

  it("refuses a file over the size limit", () => {
    expect(
      checkUpload(
        { name: "big.jpg", type: "image/jpeg", size: 20 * MB + 1 },
        DEFAULT_IMAGE_RULE
      )
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a type the discipline doesn't take", () => {
    for (const [name, type] of [
      ["clip.mp4", "video/mp4"],
      ["anim.gif", "image/gif"],
      ["essay.pdf", "application/pdf"],
      ["burst.heics", "image/heic-sequence"],
      ["mystery", ""],
    ] as const) {
      expect(
        checkUpload({ name, type, size: 1000 }, DEFAULT_IMAGE_RULE)
      ).toEqual({ ok: false, reason: "wrong_type" });
    }
  });

  it("refuses an empty file before looking at anything else", () => {
    expect(
      checkUpload(
        { name: "a.gif", type: "image/gif", size: 0 },
        DEFAULT_IMAGE_RULE
      )
    ).toEqual({ ok: false, reason: "empty" });
  });

  it("names the wrong type before the size", () => {
    expect(
      checkUpload(
        { name: "huge.mp4", type: "video/mp4", size: 500 * MB },
        DEFAULT_IMAGE_RULE
      )
    ).toEqual({ ok: false, reason: "wrong_type" });
  });

  it("treats a size that isn't a whole number of bytes as no file", () => {
    for (const size of [-1, 1.5, Number.NaN]) {
      expect(
        checkUpload(
          { name: "a.jpg", type: "image/jpeg", size },
          DEFAULT_IMAGE_RULE
        )
      ).toEqual({ ok: false, reason: "empty" });
    }
  });
});

describe("acceptAttribute", () => {
  it("lists types and extensions, so pickers offer HEIC photos too", () => {
    expect(acceptAttribute(DEFAULT_IMAGE_RULE)).toBe(
      "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
    );
  });
});

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

describe("uploadTypeOf for videos", () => {
  it("normalises the reported type, reading video/x-m4v as MP4", () => {
    expect(uploadTypeOf({ name: "a.mp4", type: "Video/MP4; codecs=avc1" })).toBe(
      "video/mp4"
    );
    expect(uploadTypeOf({ name: "a.m4v", type: "video/x-m4v" })).toBe(
      "video/mp4"
    );
  });

  it("goes by the extension when the reported type says nothing", () => {
    for (const type of ["", "application/octet-stream"]) {
      expect(uploadTypeOf({ name: "IMG_0042.MOV", type })).toBe(
        "video/quicktime"
      );
      expect(uploadTypeOf({ name: "clip.3gp", type })).toBe("video/3gpp");
      expect(uploadTypeOf({ name: "clip.webm", type })).toBe("video/webm");
      expect(uploadTypeOf({ name: "clip.m4v", type })).toBe("video/mp4");
      expect(uploadTypeOf({ name: "clip.MP4", type })).toBe("video/mp4");
    }
  });
});

describe("checkUpload with the default video rule", () => {
  it("takes MP4, MOV, 3GP and WebM up to 200 MB and 3 minutes", () => {
    for (const [name, type] of [
      ["a.mp4", "video/mp4"],
      ["a.mov", "video/quicktime"],
      ["a.3gp", "video/3gpp"],
      ["a.webm", "video/webm"],
    ] as const) {
      expect(
        checkUpload(
          { name, type, size: 200 * MB, durationMs: 180_000 },
          DEFAULT_VIDEO_RULE
        )
      ).toEqual({ ok: true, contentType: type });
    }
  });

  it("accepts a phone clip the browser reports no type for", () => {
    expect(
      checkUpload(clip({ type: "" }), DEFAULT_VIDEO_RULE)
    ).toEqual({ ok: true, contentType: "video/quicktime" });
  });

  it("refuses an empty file first", () => {
    expect(
      checkUpload(clip({ size: 0, type: "text/plain" }), DEFAULT_VIDEO_RULE)
    ).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses formats phones don't record or browsers can't hand us", () => {
    for (const file of [
      clip({ name: "a.avi", type: "video/x-msvideo" }),
      clip({ name: "a.mkv", type: "video/x-matroska" }),
      clip({ name: "a.png", type: "image/png" }),
      clip({ name: "a.bin", type: "" }),
    ]) {
      expect(checkUpload(file, DEFAULT_VIDEO_RULE)).toEqual({
        ok: false,
        reason: "wrong_type",
      });
    }
  });

  it("refuses a file one byte over the size limit", () => {
    expect(
      checkUpload(clip({ size: 200 * MB + 1 }), DEFAULT_VIDEO_RULE)
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a clip over the length limit, with a second of slack", () => {
    expect(
      checkUpload(clip({ durationMs: 181_000 }), DEFAULT_VIDEO_RULE)
    ).toMatchObject({ ok: true });
    expect(
      checkUpload(clip({ durationMs: 181_001 }), DEFAULT_VIDEO_RULE)
    ).toEqual({ ok: false, reason: "too_long" });
  });

  it("names the size before the length", () => {
    expect(
      checkUpload(
        clip({ size: 300 * MB, durationMs: 600_000 }),
        DEFAULT_VIDEO_RULE
      )
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("lets the media worker decide when the browser can't read the length", () => {
    for (const durationMs of [null, undefined, Number.NaN, Infinity]) {
      expect(
        checkUpload(clip({ durationMs }), DEFAULT_VIDEO_RULE)
      ).toMatchObject({ ok: true });
    }
  });

  it("checks against the competition's own rule", () => {
    const shortClips = {
      acceptedTypes: ["video/mp4"] as const,
      maxBytes: 50 * MB,
      maxDurationMs: 60_000,
    };
    expect(checkUpload(clip(), shortClips)).toEqual({
      ok: false,
      reason: "wrong_type",
    });
    expect(
      checkUpload(
        clip({ name: "a.mp4", type: "video/mp4", durationMs: 90_000 }),
        shortClips
      )
    ).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("checkUpload with a rule that has no length limit", () => {
  it("ignores any length the browser reports", () => {
    expect(
      checkUpload(
        { name: "a.jpg", type: "image/jpeg", size: MB, durationMs: 999_999 },
        DEFAULT_IMAGE_RULE
      )
    ).toEqual({ ok: true, contentType: "image/jpeg" });
  });
});

describe("acceptAttribute for videos", () => {
  it("lists the types, then their extensions", () => {
    expect(acceptAttribute(DEFAULT_VIDEO_RULE)).toBe(
      "video/mp4,video/quicktime,video/3gpp,video/webm,.mp4,.m4v,.mov,.3gp,.webm"
    );
  });
});
