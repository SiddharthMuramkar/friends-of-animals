import { describe, expect, it } from "vitest";

import {
  INITIAL_RELEASE_STATUS,
  RELEASE_CAUSES,
  RESULTS_RELEASE_STATUSES,
  canTransitionRelease,
  isLiveRelease,
  isTerminalRelease,
  releaseTransitionCauses,
  type ReleaseCause,
} from "./release-status";

// Every ordered pair of statuses with the causes that may make the move.
// A pair that is not listed is forbidden for everyone.
const ALLOWED: Record<string, readonly ReleaseCause[]> = {
  "pending_approval->approved": ["approver"],
  "pending_approval->rejected": ["approver", "system"],
  "approved->published": ["system"],
  "approved->rejected": ["approver", "system"],
};

const PAIRS = RESULTS_RELEASE_STATUSES.flatMap((from) =>
  RESULTS_RELEASE_STATUSES.map((to) => [from, to] as const)
);

describe("the results release status machine", () => {
  it("knows every status up front, starting from pending approval", () => {
    expect(RESULTS_RELEASE_STATUSES).toEqual([
      "pending_approval",
      "approved",
      "published",
      "rejected",
    ]);
    expect(INITIAL_RELEASE_STATUS).toBe("pending_approval");
    expect(RELEASE_CAUSES).toEqual(["preparer", "approver", "system"]);
  });

  it.each(PAIRS)("%s -> %s has the causes the table gives", (from, to) => {
    expect(releaseTransitionCauses(from, to)).toEqual(
      ALLOWED[`${from}->${to}`] ?? []
    );
  });

  it.each(PAIRS)("%s -> %s is allowed only for its own causes", (from, to) => {
    const causes = ALLOWED[`${from}->${to}`] ?? [];
    for (const by of RELEASE_CAUSES) {
      expect(canTransitionRelease(from, to, by)).toBe(causes.includes(by));
    }
  });

  it("lets nobody publish without an approval first", () => {
    for (const by of RELEASE_CAUSES) {
      expect(canTransitionRelease("pending_approval", "published", by)).toBe(
        false
      );
    }
  });

  it("lets only the system publish, never a person", () => {
    expect(canTransitionRelease("approved", "published", "approver")).toBe(
      false
    );
    expect(canTransitionRelease("approved", "published", "preparer")).toBe(
      false
    );
  });

  it("never lets the preparer approve or reject", () => {
    expect(
      canTransitionRelease("pending_approval", "approved", "preparer")
    ).toBe(false);
    expect(
      canTransitionRelease("pending_approval", "rejected", "preparer")
    ).toBe(false);
  });

  it("makes published and rejected terminal", () => {
    expect(isTerminalRelease("published")).toBe(true);
    expect(isTerminalRelease("rejected")).toBe(true);
    for (const to of RESULTS_RELEASE_STATUSES) {
      expect(releaseTransitionCauses("published", to)).toEqual([]);
      expect(releaseTransitionCauses("rejected", to)).toEqual([]);
    }
    expect(isTerminalRelease("approved")).toBe(false);
  });

  it("counts pending and approved as the one live release", () => {
    expect(RESULTS_RELEASE_STATUSES.filter(isLiveRelease)).toEqual([
      "pending_approval",
      "approved",
    ]);
  });
});
