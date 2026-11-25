import { describe, expect, it } from "vitest";

import { outcomesToTell, type ToldOutcome } from "./outcome-changes";

type Row = ToldOutcome & { registrationId: string };

const shortlisted = (registrationId: string, position: number | null): Row => ({
  registrationId,
  outcome: "shortlisted",
  position,
});
const notShortlisted = (registrationId: string): Row => ({
  registrationId,
  outcome: "not_shortlisted",
  position: null,
});

describe("outcomesToTell", () => {
  it("tells every family the first time a round is decided", () => {
    const next = [shortlisted("a", 1), notShortlisted("b")];

    expect(outcomesToTell([], next)).toEqual(next);
  });

  it("tells nobody when a re-finalised round decides the same again", () => {
    const told = [
      shortlisted("a", 1),
      shortlisted("b", null),
      notShortlisted("c"),
    ];

    expect(
      outcomesToTell(
        told,
        told.map((row) => ({ ...row }))
      )
    ).toEqual([]);
  });

  it("tells only the families whose outcome changed", () => {
    const previous = [
      shortlisted("a", null),
      notShortlisted("b"),
      notShortlisted("c"),
    ];
    const next = [
      notShortlisted("a"),
      shortlisted("b", null),
      notShortlisted("c"),
    ];

    expect(outcomesToTell(previous, next)).toEqual([
      notShortlisted("a"),
      shortlisted("b", null),
    ]);
  });

  it("tells a family whose school position changed, or was added or removed", () => {
    const previous = [
      shortlisted("a", 1),
      shortlisted("b", 2),
      shortlisted("c", null),
    ];
    const next = [
      shortlisted("a", 2),
      shortlisted("b", null),
      shortlisted("c", 3),
    ];

    expect(outcomesToTell(previous, next)).toEqual(next);
  });

  it("tells a family that wasn't part of the earlier decision", () => {
    const previous = [shortlisted("a", 1)];
    const next = [shortlisted("a", 1), shortlisted("late", null)];

    expect(outcomesToTell(previous, next)).toEqual([shortlisted("late", null)]);
  });

  it("keeps whatever else the caller put on each outcome", () => {
    const next = [{ ...shortlisted("a", 1), entryId: "e-1" }];

    expect(outcomesToTell([], next)).toEqual([
      {
        registrationId: "a",
        outcome: "shortlisted",
        position: 1,
        entryId: "e-1",
      },
    ]);
  });

  it("refuses two outcomes for one registration", () => {
    expect(() =>
      outcomesToTell([], [shortlisted("a", 1), notShortlisted("a")])
    ).toThrow(RangeError);
    expect(() =>
      outcomesToTell([shortlisted("a", 1), notShortlisted("a")], [])
    ).toThrow(RangeError);
  });
});
