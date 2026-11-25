import { describe, expect, it } from "vitest";

import {
  donationInputFrom,
  EMPTY_DONATION,
  enteredFrom,
  rupeesToPaise,
  type DonateEntered,
} from "./donate-input";

describe("rupeesToPaise", () => {
  it.each([
    ["500", 50_000n],
    ["0.01", 1n],
    ["500.5", 50_050n],
    ["500.50", 50_050n],
    ["1,500", 150_000n],
    ["1,00,000", 10_000_000n],
    ["  750  ", 75_000n],
    ["₹500", 50_000n],
    ["₹ 2,500", 250_000n],
  ])("reads %j as %s paise", (typed, paise) => {
    expect(rupeesToPaise(typed)).toBe(paise);
  });

  it.each(["", "   ", "abc", "-500", "5e3", "500.", ".5", "500.555", "1.2.3"])(
    "refuses %j",
    (typed) => {
      expect(rupeesToPaise(typed)).toBeNull();
    }
  );

  it("reads zero as zero, for the use case to refuse", () => {
    expect(rupeesToPaise("0")).toBe(0n);
  });
});

const filled = (overrides: Partial<DonateEntered> = {}): DonateEntered => ({
  ...EMPTY_DONATION,
  amount: "1000",
  name: "Asha Rao",
  email: "asha@example.test",
  declaredAdult: true,
  declaredIndianSource: true,
  ...overrides,
});

describe("donationInputFrom", () => {
  it("takes a chip's amount in paise", () => {
    expect(donationInputFrom(filled())).toEqual({
      ok: true,
      input: {
        amountMinor: 100_000n,
        donorType: "individual",
        name: "Asha Rao",
        email: "asha@example.test",
        showOnWall: false,
        declaredAdult: true,
        declaredIndianSource: true,
      },
    });
  });

  it("takes another amount as typed, and a company's choice", () => {
    expect(
      donationInputFrom(
        filled({
          amount: "other",
          otherAmount: "₹12,345.50",
          donorType: "csr",
          organisationName: "Acme Foundation",
          disclose: "no",
          showOnWall: true,
          wallName: "A friend",
        })
      )
    ).toMatchObject({
      ok: true,
      input: {
        amountMinor: 1_234_550n,
        donorType: "csr",
        organisationName: "Acme Foundation",
        discloseOrganisation: false,
        showOnWall: true,
        wallName: "A friend",
      },
    });
  });

  it("asks again for what is missing before sending anything", () => {
    expect(
      donationInputFrom({
        ...EMPTY_DONATION,
        donorType: "corporate",
        amount: "other",
        otherAmount: "lots",
      })
    ).toEqual({
      ok: false,
      fields: [
        "amount",
        "name",
        "email",
        "organisationName",
        "disclose",
        "declarations",
      ],
    });
  });
});

describe("enteredFrom", () => {
  it("reads ticked boxes as on and blanks as empty", () => {
    const form = new FormData();
    form.set("amount", "500");
    form.set("showOnWall", "on");
    form.set("declaredAdult", "on");
    expect(enteredFrom(form)).toEqual({
      ...EMPTY_DONATION,
      amount: "500",
      showOnWall: true,
      declaredAdult: true,
    });
  });
});
