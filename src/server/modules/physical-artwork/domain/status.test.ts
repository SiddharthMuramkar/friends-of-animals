import { describe, expect, it } from "vitest";

import {
  ARTWORK_TRANSITIONS,
  PHYSICAL_ARTWORK_STATUSES,
  artworkTransition,
  isPhysicalArtworkStatus,
} from "./status";

/** Every move this module allows, and who makes it. */
const ALLOWED: Record<string, "sender" | "staff"> = {
  "requested→dispatched": "sender",
  "dispatched→received": "staff",
  "requested→received": "staff",
  "received→verified": "staff",
  "received→discrepancy": "staff",
  "discrepancy→received": "staff",
  "verified→on_exhibition": "staff",
  "retained→on_exhibition": "staff",
  "on_exhibition→verified": "staff",
  "verified→retained": "staff",
  "on_exhibition→retained": "staff",
  "received→returned": "staff",
  "discrepancy→returned": "staff",
  "verified→returned": "staff",
  "on_exhibition→returned": "staff",
};

const pairs = PHYSICAL_ARTWORK_STATUSES.flatMap((from) =>
  PHYSICAL_ARTWORK_STATUSES.map((to) => [from, to] as const)
);

describe("physical artwork statuses", () => {
  it("lists every status the artwork can ever hold, in custody order", () => {
    expect(PHYSICAL_ARTWORK_STATUSES).toEqual([
      "requested",
      "dispatched",
      "received",
      "discrepancy",
      "verified",
      "on_exhibition",
      "retained",
      "returned",
    ]);
  });

  it("recognises its own statuses and nothing else", () => {
    for (const status of PHYSICAL_ARTWORK_STATUSES) {
      expect(isPhysicalArtworkStatus(status)).toBe(true);
    }
    for (const other of ["", "REQUESTED", "auctioned", "cancelled", 1, null]) {
      expect(isPhysicalArtworkStatus(other)).toBe(false);
    }
  });
});

describe("physical artwork transition table", () => {
  it("covers all 64 status pairs", () => {
    expect(pairs).toHaveLength(64);
  });

  it.each(pairs)("%s → %s", (from, to) => {
    const allowedBy = ALLOWED[`${from}→${to}`];
    const transition = artworkTransition(from, to);
    if (allowedBy) {
      expect(transition).toEqual({ from, to, by: allowedBy });
    } else {
      expect(transition).toBeNull();
    }
  });

  it("holds exactly the allowed moves, each once", () => {
    expect(
      ARTWORK_TRANSITIONS.map(({ from, to, by }) => [`${from}→${to}`, by])
    ).toEqual(Object.entries(ALLOWED));
  });

  it("never returns to parcel dispatch after receipt or leaves returned", () => {
    expect(artworkTransition("received", "dispatched")).toBeNull();
    expect(artworkTransition("dispatched", "requested")).toBeNull();
    expect(artworkTransition("returned", "verified")).toBeNull();
  });
});
