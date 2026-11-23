import { describe, expect, it } from "vitest";

import { ageGroupFor, type AgeGroup } from "./age-group";

const d = (year: number, month: number, day: number) => ({ year, month, day });

const JUNIORS: AgeGroup = { id: "g-6", label: "6–9", minAge: 6, maxAge: 9 };
const SENIORS: AgeGroup = {
  id: "g-10",
  label: "10–13",
  minAge: 10,
  maxAge: 13,
};
const GROUPS = [SENIORS, JUNIORS];
const CUTOFF = d(2027, 6, 1);

describe("ageGroupFor", () => {
  it.each([
    ["10 on the cut-off day", d(2017, 6, 1), SENIORS, 10],
    ["still 9 on the cut-off day", d(2017, 6, 2), JUNIORS, 9],
    ["exactly the youngest age", d(2021, 6, 1), JUNIORS, 6],
    ["13, turning 14 the day after", d(2013, 6, 2), SENIORS, 13],
  ])("places someone %s", (_case, birth, group, age) => {
    expect(ageGroupFor(birth, CUTOFF, GROUPS)).toEqual({
      ok: true,
      group,
      age,
    });
  });

  it("places a 29 February birthday by 1 March in other years", () => {
    expect(ageGroupFor(d(2016, 2, 29), d(2027, 2, 28), GROUPS)).toEqual({
      ok: true,
      group: SENIORS,
      age: 10,
    });
  });

  it.each([
    ["too old", d(2013, 6, 1), 14],
    ["too young", d(2021, 6, 2), 5],
    ["born after the cut-off", d(2027, 7, 1), -1],
  ])("refuses someone %s, naming every group", (_case, birth, age) => {
    expect(ageGroupFor(birth, CUTOFF, GROUPS)).toEqual({
      ok: false,
      reason: "outside_age_groups",
      age,
      groups: [JUNIORS, SENIORS],
    });
  });

  it("refuses an age that falls in a gap between groups", () => {
    const gappy = [
      { id: "a", label: "6–8", minAge: 6, maxAge: 8 },
      { id: "b", label: "10–12", minAge: 10, maxAge: 12 },
    ];
    const result = ageGroupFor(d(2018, 6, 1), CUTOFF, gappy);
    expect(result).toMatchObject({
      ok: false,
      reason: "outside_age_groups",
      age: 9,
    });
  });

  it("refuses rather than guesses when groups overlap", () => {
    const overlapping = [
      { id: "a", label: "6–10", minAge: 6, maxAge: 10 },
      { id: "b", label: "10–13", minAge: 10, maxAge: 13 },
    ];
    expect(ageGroupFor(d(2017, 6, 1), CUTOFF, overlapping)).toEqual({
      ok: false,
      reason: "overlapping_age_groups",
      age: 10,
      groups: overlapping,
    });
  });

  it("refuses when the competition has no age groups", () => {
    expect(ageGroupFor(d(2017, 6, 1), CUTOFF, [])).toEqual({
      ok: false,
      reason: "no_age_groups",
    });
  });
});
