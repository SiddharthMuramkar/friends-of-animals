import { describe, expect, it } from "vitest";

import { chooseDiscipline, formatOf, uploadRuleFor } from "./rules";

describe("uploadRuleFor", () => {
  it.each(["drawing", "painting", "art", "craft", "photography"])(
    "takes JPEG, PNG, WebP, HEIC and HEIF up to 20 MB for %s",
    (discipline) => {
      expect(uploadRuleFor(discipline)).toEqual({
        kind: "image",
        acceptedTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/heic",
          "image/heif",
        ],
        maxBytes: 20_971_520,
      });
    }
  );

  it("takes MP4, MOV, 3GP and WebM up to 200 MB and 3 minutes for videography (#86)", () => {
    expect(uploadRuleFor("videography")).toEqual({
      kind: "video",
      acceptedTypes: [
        "video/mp4",
        "video/quicktime",
        "video/3gpp",
        "video/webm",
      ],
      maxBytes: 209_715_200,
      maxDurationMs: 180_000,
    });
  });

  it("takes a PDF up to 10 MB for an essay uploaded as a document (#86)", () => {
    expect(uploadRuleFor("essay")).toEqual({
      kind: "document",
      acceptedTypes: ["application/pdf"],
      maxBytes: 10_485_760,
    });
  });

  it("has no rule for a discipline it doesn't know", () => {
    expect(uploadRuleFor("sculpture")).toBeNull();
    expect(formatOf("sculpture")).toBeNull();
  });
});

describe("formatOf", () => {
  it("names each discipline's format", () => {
    expect(formatOf("painting")).toBe("image");
    expect(formatOf("videography")).toBe("video");
    expect(formatOf("essay")).toBe("essay");
  });
});

describe("chooseDiscipline", () => {
  const offered = ["drawing", "essay", "photography"];

  it("keeps the entry's own discipline, whatever is asked", () => {
    expect(
      chooseDiscipline({ offered, asked: "photography", current: "drawing" })
    ).toEqual({ ok: true, discipline: "drawing" });
  });

  it.each(["photography", "essay"])(
    "takes %s, a discipline the competition holds",
    (asked) => {
      expect(chooseDiscipline({ offered, asked })).toEqual({
        ok: true,
        discipline: asked,
      });
    }
  );

  it.each(["videography", "painting", "sculpture"])(
    "refuses %s, which isn't one of its disciplines",
    (asked) => {
      expect(chooseDiscipline({ offered, asked })).toEqual({
        ok: false,
        error: "discipline_not_offered",
      });
    }
  );

  it("picks the only discipline when none is asked, and asks when there are more", () => {
    expect(chooseDiscipline({ offered: ["videography"] })).toEqual({
      ok: true,
      discipline: "videography",
    });
    expect(chooseDiscipline({ offered })).toEqual({
      ok: false,
      error: "discipline_required",
    });
    expect(chooseDiscipline({ offered: [] })).toEqual({
      ok: false,
      error: "discipline_not_offered",
    });
  });
});
