import { describe, expect, it } from "vitest";

import { chooseDiscipline, uploadRuleFor } from "./rules";

describe("uploadRuleFor", () => {
  it.each(["drawing", "painting", "art", "craft", "photography"])(
    "takes JPEG, PNG, WebP, HEIC and HEIF up to 20 MB for %s",
    (discipline) => {
      expect(uploadRuleFor(discipline)).toEqual({
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

  it.each(["essay", "videography"])(
    "has no image rule for %s, whose work is another kind of file",
    (discipline) => {
      expect(uploadRuleFor(discipline)).toBeNull();
    }
  );

  it("has no rule for a discipline it doesn't know", () => {
    expect(uploadRuleFor("sculpture")).toBeNull();
  });
});

describe("chooseDiscipline", () => {
  const offered = ["drawing", "essay", "photography"];

  it("keeps the entry's own discipline, whatever is asked", () => {
    expect(
      chooseDiscipline({ offered, asked: "photography", current: "drawing" })
    ).toEqual({ ok: true, discipline: "drawing" });
  });

  it("takes a picture discipline the competition holds", () => {
    expect(chooseDiscipline({ offered, asked: "photography" })).toEqual({
      ok: true,
      discipline: "photography",
    });
  });

  it.each(["essay", "painting", "sculpture"])(
    "refuses %s, which isn't one of its picture disciplines",
    (asked) => {
      expect(chooseDiscipline({ offered, asked })).toEqual({
        ok: false,
        error: "discipline_not_offered",
      });
    }
  );

  it("picks the only picture discipline when none is asked, and asks when there are more", () => {
    expect(chooseDiscipline({ offered: ["drawing", "essay"] })).toEqual({
      ok: true,
      discipline: "drawing",
    });
    expect(chooseDiscipline({ offered })).toEqual({
      ok: false,
      error: "discipline_required",
    });
    expect(chooseDiscipline({ offered: ["essay"] })).toEqual({
      ok: false,
      error: "discipline_not_offered",
    });
  });
});
