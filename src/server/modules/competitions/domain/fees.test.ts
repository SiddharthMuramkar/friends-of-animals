import { describe, expect, it } from "vitest";

import {
  decideFees,
  feeChanges,
  feeEditAllowed,
  feeView,
  formatPaiseForInput,
  offeredRoutes,
  parseRupeesToPaise,
} from "./fees";

describe("parseRupeesToPaise", () => {
  it.each([
    ["1500", 150000n],
    ["1,500", 150000n],
    ["1,24,000", 12400000n],
    ["₹1,500.50", 150050n],
    [" 25000.5 ", 2500050n],
    ["0", 0n],
    ["0.05", 5n],
    // More than 2^31 paise survives exactly: bigint all the way.
    ["21474836.49", 2147483649n],
    ["92233720368547758.07", 9223372036854775807n],
  ])("reads %j as %s paise", (input, paise) => {
    expect(parseRupeesToPaise(input)).toEqual({ ok: true, paise });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["-5", "invalid_amount"],
    ["1.234", "invalid_amount"],
    ["1e3", "invalid_amount"],
    ["abc", "invalid_amount"],
    ["1,5,00.", "invalid_amount"],
    ["12.", "invalid_amount"],
    [".5", "invalid_amount"],
    ["Infinity", "invalid_amount"],
    // One paisa past the largest value a Postgres bigint holds.
    ["92233720368547758.08", "too_large"],
  ])("refuses %j with %s", (input, error) => {
    expect(parseRupeesToPaise(input)).toEqual({ ok: false, error });
  });
});

describe("formatPaiseForInput", () => {
  it.each([
    [150000n, "1500"],
    [150050n, "1500.50"],
    [5n, "0.05"],
    [0n, "0"],
    [2147483649n, "21474836.49"],
  ])("writes %s paise as %j, which parses back", (paise, text) => {
    expect(formatPaiseForInput(paise)).toBe(text);
    expect(parseRupeesToPaise(text)).toEqual({ ok: true, paise });
  });

  it("refuses a negative amount", () => {
    expect(() => formatPaiseForInput(-1n)).toThrow(RangeError);
  });
});

describe("offeredRoutes", () => {
  it("offers no route while a draft has no participation chosen", () => {
    expect(offeredRoutes(null)).toEqual([]);
  });

  it("follows the competition's participation", () => {
    expect(offeredRoutes("individuals")).toEqual(["individual"]);
    expect(offeredRoutes("institutions")).toEqual(["institution"]);
    expect(offeredRoutes("both")).toEqual(["individual", "institution"]);
  });
});

describe("decideFees", () => {
  it("sets a fee for every offered route", () => {
    expect(
      decideFees("both", {
        fees: { individual: "1,500", institution: "25000.50" },
        currency: "INR",
      })
    ).toEqual({
      ok: true,
      fees: { individual: 150000n, institution: 2500050n },
    });
  });

  it("makes every offered route free", () => {
    expect(decideFees("both", { free: true })).toEqual({
      ok: true,
      fees: { individual: 0n, institution: 0n },
    });
    expect(decideFees("institutions", { free: true })).toEqual({
      ok: true,
      fees: { institution: 0n },
    });
  });

  it("allows one route free and the other paid", () => {
    expect(
      decideFees("both", {
        fees: { individual: "0", institution: "500" },
        currency: "INR",
      })
    ).toEqual({ ok: true, fees: { individual: 0n, institution: 50000n } });
  });

  it("refuses any currency but INR", () => {
    expect(
      decideFees("individuals", { fees: { individual: "10" }, currency: "USD" })
    ).toEqual({
      ok: false,
      problems: [{ code: "unsupported_currency" }],
    });
  });

  it("names every route with a problem", () => {
    expect(
      decideFees("individuals", {
        fees: { individual: "-1", institution: "100" },
        currency: "INR",
      })
    ).toEqual({
      ok: false,
      problems: [
        { code: "invalid_amount", route: "individual" },
        { code: "route_not_offered", route: "institution" },
      ],
    });
  });

  it("asks for a fee on every offered route", () => {
    expect(
      decideFees("both", {
        fees: { individual: "100", institution: "  " },
        currency: "INR",
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "missing_fee", route: "institution" }],
    });
  });

  it("refuses an amount too large for the database", () => {
    expect(
      decideFees("individuals", {
        fees: { individual: "92233720368547758.08" },
        currency: "INR",
      })
    ).toEqual({
      ok: false,
      problems: [{ code: "too_large", route: "individual" }],
    });
  });
});

describe("feeEditAllowed", () => {
  it("allows changes until registration opens", () => {
    expect(feeEditAllowed("draft")).toBe(true);
    expect(feeEditAllowed("published")).toBe(true);
  });

  it("locks fees once registration has opened", () => {
    expect(feeEditAllowed("registration_open")).toBe(false);
    expect(feeEditAllowed("registration_closed")).toBe(false);
    // A status a later ticket adds is locked unless listed.
    expect(feeEditAllowed("cancelled")).toBe(false);
  });
});

describe("feeView", () => {
  it("shows what a visitor reads for each offered route", () => {
    expect(feeView("both", { individual: 0n, institution: 150050n })).toEqual([
      { route: "individual", kind: "free" },
      { route: "institution", kind: "amount", paise: 150050n },
    ]);
  });

  it("marks an offered route with no fee yet as not set", () => {
    expect(feeView("both", { institution: 100n })).toEqual([
      { route: "individual", kind: "not_set" },
      { route: "institution", kind: "amount", paise: 100n },
    ]);
  });

  it("leaves out a stored fee for a route no longer offered", () => {
    expect(
      feeView("individuals", { individual: 100n, institution: 200n })
    ).toEqual([{ route: "individual", kind: "amount", paise: 100n }]);
  });
});

describe("feeChanges", () => {
  it("is null when every amount stays the same", () => {
    expect(
      feeChanges(
        { individual: 150000n, institution: 0n },
        { institution: 0n, individual: 150000n }
      )
    ).toBeNull();
  });

  it("lists only the routes that changed, with paise as text", () => {
    expect(
      feeChanges(
        { individual: 150000n, institution: 2500050n },
        { individual: 150000n, institution: 2147483649n }
      )
    ).toEqual({
      before: { institution: "2500050" },
      after: { institution: "2147483649" },
    });
  });

  it("shows a newly set route as null before, a removed one as null after", () => {
    expect(feeChanges({ institution: 100n }, { individual: 0n })).toEqual({
      before: { individual: null, institution: "100" },
      after: { individual: "0", institution: null },
    });
  });
});

describe("feeView without a participation", () => {
  it("shows no route", () => {
    expect(feeView(null, { individual: 100n })).toEqual([]);
  });
});
