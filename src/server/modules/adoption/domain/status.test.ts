import { describe, expect, it } from "vitest";

import {
  ADOPTION_LISTING_STATUSES,
  AdoptionTransitionError,
  acceptsChanges,
  canMoveAdoptionListing,
  moveAdoptionListing,
  publicVisibility,
  type AdoptionListingStatus,
  type AdoptionMover,
} from "./status";

// Every allowed move and who may make it, written out by hand so a change
// to the table in status.ts has to change this list too. Every other pair
// is forbidden for everyone.
const ALLOWED: ReadonlyArray<
  [AdoptionListingStatus | null, AdoptionListingStatus, AdoptionMover]
> = [
  [null, "draft", "representative"],
  ["draft", "published", "representative"],
  ["published", "on_hold", "representative"],
  ["on_hold", "published", "representative"],
  ["published", "adopted", "coordinator"],
  ["on_hold", "adopted", "coordinator"],
  ["draft", "withdrawn", "representative"],
  ["published", "withdrawn", "representative"],
  ["on_hold", "withdrawn", "representative"],
];

const MOVERS: readonly AdoptionMover[] = ["representative", "coordinator"];

const key = (from: string | null, to: string, by: string) =>
  `${from ?? "(new)"} -> ${to} by ${by}`;
const allowed = new Set(ALLOWED.map(([from, to, by]) => key(from, to, by)));
const triples = [null, ...ADOPTION_LISTING_STATUSES].flatMap((from) =>
  ADOPTION_LISTING_STATUSES.flatMap((to) =>
    MOVERS.map((by) => [from, to, by] as const)
  )
);

describe("adoption listing statuses", () => {
  it("has the five statuses the schema enum is built from", () => {
    expect(ADOPTION_LISTING_STATUSES).toEqual([
      "draft",
      "published",
      "on_hold",
      "adopted",
      "withdrawn",
    ]);
  });

  it.each(triples.filter(([from, to, by]) => allowed.has(key(from, to, by))))(
    "allows %s -> %s by %s",
    (from, to, by) => {
      expect(canMoveAdoptionListing(from, to, by)).toBe(true);
      expect(moveAdoptionListing(from, to, by)).toBe(to);
    }
  );

  it.each(triples.filter(([from, to, by]) => !allowed.has(key(from, to, by))))(
    "forbids %s -> %s by %s",
    (from, to, by) => {
      expect(canMoveAdoptionListing(from, to, by)).toBe(false);
      expect(() => moveAdoptionListing(from, to, by)).toThrow(
        AdoptionTransitionError
      );
    }
  );

  it("names both ends and the mover of a forbidden move", () => {
    expect(() =>
      moveAdoptionListing("withdrawn", "published", "representative")
    ).toThrow(
      "An adoption listing can't move from withdrawn to published (representative)"
    );
    expect(() =>
      moveAdoptionListing(null, "published", "representative")
    ).toThrow(
      "An adoption listing can't move from (new) to published (representative)"
    );
  });

  it("keeps adopted and withdrawn final", () => {
    for (const to of ADOPTION_LISTING_STATUSES) {
      for (const by of MOVERS) {
        expect(canMoveAdoptionListing("adopted", to, by)).toBe(false);
        expect(canMoveAdoptionListing("withdrawn", to, by)).toBe(false);
      }
    }
  });

  it("takes edits and photos only while the listing is open", () => {
    expect(ADOPTION_LISTING_STATUSES.filter(acceptsChanges)).toEqual([
      "draft",
      "published",
      "on_hold",
    ]);
  });
});

describe("publicVisibility", () => {
  const cases: ReadonlyArray<
    [AdoptionListingStatus, boolean, ReturnType<typeof publicVisibility>]
  > = [
    ["draft", true, "hidden"],
    ["published", true, "listed"],
    ["on_hold", true, "page_only"],
    ["adopted", true, "page_only"],
    ["withdrawn", true, "hidden"],
  ];

  it.each(cases)(
    "a %s listing of a verified directory listing is %s",
    (status, verified, expected) => {
      expect(publicVisibility(status, verified)).toBe(expected);
    }
  );

  it.each(ADOPTION_LISTING_STATUSES)(
    "hides a %s listing whose directory listing is not verified",
    (status) => {
      expect(publicVisibility(status, false)).toBe("hidden");
    }
  );
});
