import { describe, expect, it } from "vitest";

import { phaseDates } from "./phase-dates";

const NOW = new Date("2027-01-15T04:30:00.000Z");

describe("phaseDates", () => {
  it("puts a competition in its submission window: registration closed, submissions open", () => {
    expect(
      phaseDates({ phase: "submission", schoolsTakePart: true, now: NOW })
    ).toEqual({
      registration_opens: new Date("2027-01-07T04:30:00.000Z"),
      registration_closes: new Date("2027-01-14T04:30:00.000Z"),
      submissions_close: new Date("2027-01-22T04:30:00.000Z"),
      school_round_closes: new Date("2027-01-29T04:30:00.000Z"),
    });
  });
});
