import { describe, expect, it } from "vitest";

import {
  acceptAttribute,
  checkUpload,
  DEFAULT_IMAGE_RULE,
  uploadTypeOf,
} from "./upload-rules";

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
