import { describe, expect, it } from "vitest";

import { LOT_CURRENCY, validateLotTerms } from "./lot-terms";

const NOW = new Date("2027-01-15T04:30:00.000Z");

/** ₹2,000 base, ₹5,000 reserve, opening tomorrow for a week. */
const TERMS = {
  basePricePaise: 200_000n,
  reservePricePaise: 500_000n,
  opensAt: new Date("2027-01-16T04:30:00.000Z"),
  closesAt: new Date("2027-01-23T04:30:00.000Z"),
};

/** The largest value a Postgres bigint holds. */
const BIGINT_MAX = 9_223_372_036_854_775_807n;

describe("lot terms", () => {
  it("are in rupees, stored as paise", () => {
    expect(LOT_CURRENCY).toBe("INR");
  });

  it("are accepted when the reserve is above the base and the dates are in order", () => {
    expect(validateLotTerms(TERMS, NOW)).toEqual({ ok: true });
  });

  it("accept a reserve equal to the base", () => {
    expect(
      validateLotTerms({ ...TERMS, reservePricePaise: 200_000n }, NOW)
    ).toEqual({ ok: true });
  });

  it("accept the largest price a bigint column holds", () => {
    expect(
      validateLotTerms(
        { ...TERMS, basePricePaise: BIGINT_MAX, reservePricePaise: BIGINT_MAX },
        NOW
      )
    ).toEqual({ ok: true });
  });

  it.each([
    ["a zero base price", { basePricePaise: 0n }, ["base_price_not_positive"]],
    [
      "a negative base price",
      { basePricePaise: -100n, reservePricePaise: 100n },
      ["base_price_not_positive"],
    ],
    [
      "a reserve below the base",
      { reservePricePaise: 199_999n },
      ["reserve_below_base"],
    ],
    [
      "a price too large for the database",
      { basePricePaise: 1n, reservePricePaise: BIGINT_MAX + 1n },
      ["price_too_large"],
    ],
    ["opening now", { opensAt: NOW }, ["opens_in_past"]],
    [
      "opening in the past",
      { opensAt: new Date("2027-01-15T04:29:59.999Z") },
      ["opens_in_past"],
    ],
    [
      "closing when it opens",
      { closesAt: TERMS.opensAt },
      ["closes_before_opens"],
    ],
    [
      "closing before it opens",
      { closesAt: new Date("2027-01-16T04:29:59.999Z") },
      ["closes_before_opens"],
    ],
    ["an invalid date", { closesAt: new Date("not a date") }, ["invalid_date"]],
  ] as const)("are refused with %s", (_, change, errors) => {
    expect(validateLotTerms({ ...TERMS, ...change }, NOW)).toEqual({
      ok: false,
      errors,
    });
  });

  it("report every problem at once, in a fixed order", () => {
    expect(
      validateLotTerms(
        {
          basePricePaise: 0n,
          reservePricePaise: -1n,
          opensAt: new Date("2027-01-01T00:00:00.000Z"),
          closesAt: new Date("2026-12-31T00:00:00.000Z"),
        },
        NOW
      )
    ).toEqual({
      ok: false,
      errors: [
        "base_price_not_positive",
        "reserve_below_base",
        "opens_in_past",
        "closes_before_opens",
      ],
    });
  });
});
