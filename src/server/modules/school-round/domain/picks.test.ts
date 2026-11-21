import { describe, expect, it } from "vitest";

import { checkCategoryPicks, type PickCandidate } from "./picks";

// #55's defaults: 5 shortlisted entries and 3 school positions per category.
const LIMITS = { shortlistSize: 5, positions: 3 };

const DRAWING = "drawing:9-12";
const PAINTING = "painting:9-12";

const submitted = (entryId: string, categoryId = DRAWING): PickCandidate => ({
  entryId,
  categoryId,
  submitted: true,
});

const SIX_DRAWINGS = ["e1", "e2", "e3", "e4", "e5", "e6"].map((id) =>
  submitted(id)
);

describe("checkCategoryPicks()", () => {
  it("accepts a shortlist of submitted entries within the size, with positions", () => {
    const picks = [
      { entryId: "e1", position: 1 },
      { entryId: "e2", position: 2 },
      { entryId: "e3", position: 3 },
      { entryId: "e4", position: null },
      { entryId: "e5", position: null },
    ];

    expect(
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks,
        limits: LIMITS,
      })
    ).toEqual({ ok: true, picks });
  });

  it("refuses entries that are not in the round, in another category, not yet submitted or picked twice", () => {
    const candidates = [
      submitted("e1"),
      submitted("p1", PAINTING),
      { entryId: "e2", categoryId: DRAWING, submitted: false },
    ];

    expect(
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates,
        picks: [
          { entryId: "elsewhere", position: null },
          { entryId: "p1", position: null },
          { entryId: "e2", position: null },
          { entryId: "e1", position: null },
          { entryId: "e1", position: null },
        ],
        limits: LIMITS,
      })
    ).toEqual({
      ok: false,
      problems: [
        { code: "unknown_entry", entryId: "elsewhere" },
        { code: "wrong_category", entryId: "p1" },
        { code: "not_submitted", entryId: "e2" },
        { code: "duplicate_entry", entryId: "e1" },
      ],
    });
  });

  it("refuses a sixth entry when the shortlist size is 5", () => {
    expect(
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks: SIX_DRAWINGS.map(({ entryId }) => ({ entryId, position: null })),
        limits: LIMITS,
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "shortlist_full", limit: 5, count: 6 }],
    });
  });

  it("follows the competition's shortlist size", () => {
    const picks = [
      { entryId: "e1", position: null },
      { entryId: "e2", position: null },
      { entryId: "e3", position: null },
    ];
    const check = (shortlistSize: number) =>
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks,
        limits: { shortlistSize, positions: 0 },
      }).ok;

    expect(check(3)).toBe(true);
    expect(check(2)).toBe(false);
  });

  it("refuses a position past the competition's number of positions, and a position given twice", () => {
    expect(
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks: [
          { entryId: "e1", position: 1 },
          { entryId: "e2", position: 1 },
          { entryId: "e3", position: 4 },
          { entryId: "e4", position: 0 },
          { entryId: "e5", position: 1.5 },
        ],
        limits: LIMITS,
      })
    ).toEqual({
      ok: false,
      problems: [
        { code: "position_taken", entryId: "e2", position: 1 },
        { code: "position_out_of_range", entryId: "e3", position: 4, limit: 3 },
        { code: "position_out_of_range", entryId: "e4", position: 0, limit: 3 },
        {
          code: "position_out_of_range",
          entryId: "e5",
          position: 1.5,
          limit: 3,
        },
      ],
    });
  });

  it("follows the competition's number of positions", () => {
    const check = (positions: number) =>
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks: [{ entryId: "e1", position: 3 }],
        limits: { shortlistSize: 5, positions },
      }).ok;

    expect(check(3)).toBe(true);
    expect(check(2)).toBe(false);
  });

  it("lets a school declare some positions, or none", () => {
    const picks = [
      { entryId: "e1", position: 2 },
      { entryId: "e2", position: null },
    ];
    expect(
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks,
        limits: LIMITS,
      })
    ).toEqual({ ok: true, picks });
  });

  it("offers no more positions than the shortlist size, since only shortlisted entries hold one", () => {
    // A competition may be saved with more positions than shortlisted
    // entries per category.
    const check = (position: number) =>
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks: [{ entryId: "e1", position }],
        limits: { shortlistSize: 3, positions: 4 },
      });

    expect(check(3)).toEqual({
      ok: true,
      picks: [{ entryId: "e1", position: 3 }],
    });
    expect(check(4)).toEqual({
      ok: false,
      problems: [
        { code: "position_out_of_range", entryId: "e1", position: 4, limit: 3 },
      ],
    });
  });

  it.each([
    { shortlistSize: 0, positions: 0 },
    { shortlistSize: 2.5, positions: 0 },
    { shortlistSize: 5, positions: -1 },
  ])("throws on impossible limits %o", (limits) => {
    expect(() =>
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: SIX_DRAWINGS,
        picks: [],
        limits,
      })
    ).toThrow(RangeError);
  });

  it("accepts an empty shortlist", () => {
    expect(
      checkCategoryPicks({
        categoryId: DRAWING,
        candidates: [],
        picks: [],
        limits: LIMITS,
      })
    ).toEqual({ ok: true, picks: [] });
  });
});
