import { describe, expect, it } from "vitest";

import { uploadRuleFor } from "./rules";

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
