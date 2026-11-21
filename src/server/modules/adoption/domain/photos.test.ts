import { describe, expect, it } from "vitest";

import {
  ADOPTION_PHOTO_KINDS,
  ADOPTION_PHOTO_LIMITS,
  checkAltText,
  publicPhotos,
  publishBlockers,
  type ListingPhoto,
} from "./photos";

const photo = (overrides: Partial<ListingPhoto> = {}): ListingPhoto => ({
  id: "p1",
  position: 1,
  altText: "Bruno, a brown Indie dog, sitting on a step",
  processing: "done",
  ...overrides,
});

describe("checkAltText", () => {
  it("normalises the description and accepts it", () => {
    expect(checkAltText("  Bruno   on a step ")).toEqual({
      ok: true,
      altText: "Bruno on a step",
    });
  });

  it("refuses a blank or overlong description", () => {
    expect(checkAltText("   ")).toEqual({ ok: false, refusal: "alt_required" });
    expect(
      checkAltText("a".repeat(ADOPTION_PHOTO_LIMITS.altTextMax + 1))
    ).toEqual({ ok: false, refusal: "alt_too_long" });
  });
});

describe("publicPhotos", () => {
  it("shows only processed photos, in position order", () => {
    const photos = [
      photo({ id: "c", position: 3 }),
      photo({ id: "a", position: 1, processing: "queued" }),
      photo({ id: "b", position: 2 }),
      photo({ id: "d", position: 4, processing: "failed" }),
    ];
    expect(publicPhotos(photos).map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("publishBlockers", () => {
  it("has none for a verified listing with a processed photo", () => {
    expect(
      publishBlockers({ directoryVerified: true, photos: [photo()] })
    ).toEqual([]);
  });

  it("needs a verified directory listing and a processed photo", () => {
    expect(publishBlockers({ directoryVerified: false, photos: [] })).toEqual([
      "directory_not_verified",
      "no_photo",
    ]);
    expect(
      publishBlockers({
        directoryVerified: true,
        photos: [
          photo({ processing: "queued" }),
          photo({ processing: "failed" }),
        ],
      })
    ).toEqual(["no_photo"]);
  });
});

describe("photo limits", () => {
  it("allows eight photos, each with the three public sizes", () => {
    expect(ADOPTION_PHOTO_LIMITS.maxPhotos).toBe(8);
    expect(ADOPTION_PHOTO_KINDS).toEqual([
      "thumb_320",
      "display_800",
      "display_1600",
    ]);
  });
});
