import { describe, expect, it } from "vitest";

import {
  assertGalleryTransition,
  canTransitionGalleryItem,
  GALLERY_ITEM_STATUSES,
  GALLERY_UNPUBLISH_REASONS,
  GalleryTransitionError,
  isPubliclyVisible,
  leavesPublicSite,
  type GalleryActorKind,
  type GalleryItemStatus,
} from "./status";

// The expected machine, written out by hand. The table in ./status.ts must
// match it row for row.
const ALLOWED: readonly (readonly [
  GalleryItemStatus | null,
  GalleryItemStatus,
  GalleryActorKind,
])[] = [
  // A content manager picks an eligible entry.
  [null, "draft", "content_manager"],
  // ...and publishes it once its stamped copy exists.
  ["draft", "published", "content_manager"],
  // Hide at once, from a report or on sight.
  ["published", "hidden", "content_manager"],
  // Restore goes back through draft, so publishing re-checks everything.
  ["hidden", "draft", "content_manager"],
  // Re-pick after consent is given again.
  ["unpublished", "draft", "content_manager"],
  // Consent withdrawn or entry disqualified: the platform takes it down.
  ["draft", "unpublished", "system"],
  ["published", "unpublished", "system"],
  ["hidden", "unpublished", "system"],
];

const FROM: readonly (GalleryItemStatus | null)[] = [
  null,
  "draft",
  "published",
  "hidden",
  "unpublished",
];
const TO: readonly GalleryItemStatus[] = [
  "draft",
  "published",
  "hidden",
  "unpublished",
];
const BY: readonly GalleryActorKind[] = ["content_manager", "system"];

const isAllowed = (
  from: GalleryItemStatus | null,
  to: GalleryItemStatus,
  by: GalleryActorKind
) => ALLOWED.some(([f, t, b]) => f === from && t === to && b === by);

const CASES = FROM.flatMap((from) =>
  TO.flatMap((to) =>
    BY.map((by) => ({ from, to, by, allowed: isAllowed(from, to, by) }))
  )
);

describe("gallery item status machine", () => {
  it("declares every status and unpublish reason up front", () => {
    expect([...GALLERY_ITEM_STATUSES]).toEqual([
      "draft",
      "published",
      "hidden",
      "unpublished",
    ]);
    expect([...GALLERY_UNPUBLISH_REASONS]).toEqual([
      "consent_withdrawn",
      "disqualified",
    ]);
  });

  it.each(CASES.filter((c) => c.allowed))(
    "allows $from -> $to by $by",
    ({ from, to, by }) => {
      expect(canTransitionGalleryItem(from, to, by)).toBe(true);
      expect(() => assertGalleryTransition(from, to, by)).not.toThrow();
    }
  );

  it.each(CASES.filter((c) => !c.allowed))(
    "forbids $from -> $to by $by",
    ({ from, to, by }) => {
      expect(canTransitionGalleryItem(from, to, by)).toBe(false);
      expect(() => assertGalleryTransition(from, to, by)).toThrow(
        GalleryTransitionError
      );
    }
  );

  it("names the refused move in the error", () => {
    expect(() =>
      assertGalleryTransition("hidden", "published", "content_manager")
    ).toThrow("A gallery item cannot move hidden -> published");
    try {
      assertGalleryTransition(null, "published", "system");
    } catch (error) {
      expect(error).toMatchObject({
        from: null,
        to: "published",
        by: "system",
      });
    }
  });
});

describe("public visibility", () => {
  it("shows only published items", () => {
    expect(GALLERY_ITEM_STATUSES.filter(isPubliclyVisible)).toEqual([
      "published",
    ]);
  });

  it("knows which moves take an item off the public site", () => {
    const leaving = CASES.filter(
      (c) => c.allowed && leavesPublicSite(c.from, c.to)
    ).map((c) => `${c.from} -> ${c.to}`);
    expect(leaving).toEqual([
      "published -> hidden",
      "published -> unpublished",
    ]);
  });
});
