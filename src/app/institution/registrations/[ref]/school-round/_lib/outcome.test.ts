import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";

import {
  decodeProblems,
  encodeProblems,
  isRoundOutcome,
  roundError,
  roundOutcome,
} from "./outcome";

const ENTRY = "01938a00-0000-7000-8000-000000000001";

describe("the school round page's outcome", () => {
  it("names what the use case answered", () => {
    expect(roundOutcome({ ok: true }, "panel_saved")).toBe("panel_saved");
    expect(
      roundOutcome({ ok: false, error: "panel_empty" }, "panel_saved")
    ).toBe("panel_empty");
    expect(
      roundOutcome(
        { ok: false, error: "finalise_blocked", blockers: [] },
        "finalised"
      )
    ).toBe("finalise_blocked");
    expect(isRoundOutcome("finalised")).toBe(true);
    expect(isRoundOutcome("nonsense")).toBe(false);
  });

  it("says forbidden for a refused actor and failed for anything else", () => {
    expect(roundError(new DomainError("forbidden", "no"))).toBe("forbidden");
    expect(roundError(new Error("database down"))).toBe("failed");
  });

  it("carries a shortlist's problems through the address", () => {
    const encoded = encodeProblems([
      { code: "not_submitted", entryId: ENTRY },
      { code: "position_out_of_range", entryId: ENTRY, position: 4, limit: 3 },
      { code: "shortlist_full", limit: 5, count: 6 },
    ]);

    expect(decodeProblems(encoded)).toEqual([
      { code: "not_submitted", entryId: ENTRY, count: null, limit: null },
      { code: "position_out_of_range", entryId: ENTRY, count: null, limit: 3 },
      { code: "shortlist_full", entryId: null, count: 6, limit: 5 },
    ]);
  });

  it("drops anything malformed in the address", () => {
    expect(
      decodeProblems("bogus~x,not_submitted~not-a-uuid,shortlist_full~a~b")
    ).toEqual([]);
    expect(decodeProblems(undefined)).toEqual([]);
  });
});
