import { describe, expect, it } from "vitest";

import { parsePan } from "./pan";
import {
  asksForPan,
  CASH_EXEMPTION_LIMIT_MINOR,
  checkTaxExemptionSettings,
  readPanInput,
  taxExemptionFor,
  type DonationForTaxExemption,
  type TaxExemptionSettings,
} from "./tax-exemption";

/** FOA's starting point: no tax exemption, nothing filled in. */
const OFF: TaxExemptionSettings = {
  has80G: false,
  wording: "",
  registrationNumber: "",
  validUntil: "",
};

/** Turned on, with every fact the receipts print. */
const ON: TaxExemptionSettings = {
  has80G: true,
  wording: "DRAFT, confirm with accountant: this donation qualifies.",
  registrationNumber: "DRAFT-REG-0001",
  validUntil: "2029-03-31",
};

describe("checkTaxExemptionSettings", () => {
  it("accepts FOA's defaults: off, nothing filled in", () => {
    expect(checkTaxExemptionSettings(OFF)).toEqual([]);
  });

  it("accepts wording and a number kept ready while still off", () => {
    expect(checkTaxExemptionSettings({ ...ON, has80G: false })).toEqual([]);
  });

  it("accepts on with wording and a registration number", () => {
    expect(checkTaxExemptionSettings(ON)).toEqual([]);
    // No end date is stated on some registrations.
    expect(checkTaxExemptionSettings({ ...ON, validUntil: "" })).toEqual([]);
  });

  it("refuses on without wording", () => {
    expect(checkTaxExemptionSettings({ ...ON, wording: "" })).toEqual([
      "wording_required",
    ]);
    expect(checkTaxExemptionSettings({ ...ON, wording: " \n\t " })).toEqual([
      "wording_required",
    ]);
  });

  it("refuses on without a registration number", () => {
    expect(
      checkTaxExemptionSettings({ ...ON, registrationNumber: "  " })
    ).toEqual(["registration_number_required"]);
  });

  it.each(["31-03-2029", "2029-3-31", "2029-02-30", "2029-13-01", "soon"])(
    "refuses an end date of %j, on or off",
    (validUntil) => {
      expect(checkTaxExemptionSettings({ ...ON, validUntil })).toEqual([
        "valid_until_invalid",
      ]);
      expect(checkTaxExemptionSettings({ ...OFF, validUntil })).toEqual([
        "valid_until_invalid",
      ]);
    }
  );

  it("accepts a leap day as an end date", () => {
    expect(
      checkTaxExemptionSettings({ ...ON, validUntil: "2028-02-29" })
    ).toEqual([]);
  });

  it("names every missing fact at once", () => {
    expect(checkTaxExemptionSettings({ ...OFF, has80G: true })).toEqual([
      "wording_required",
      "registration_number_required",
    ]);
  });
});

describe("asksForPan", () => {
  it("asks only while 80G is on with every fact filled in", () => {
    expect(asksForPan(OFF)).toBe(false);
    expect(asksForPan({ ...ON, has80G: false })).toBe(false);
    expect(asksForPan(ON)).toBe(true);
    // On but incomplete can't be saved; if it is ever read, don't ask.
    expect(asksForPan({ ...ON, wording: "" })).toBe(false);
  });
});

describe("readPanInput", () => {
  it("drops a PAN sent while 80G is off, so none is ever stored", () => {
    expect(readPanInput(OFF, "ABCPE1234F")).toEqual({ ok: true, pan: null });
    // Even an invalid one: the form never asked for it.
    expect(readPanInput(OFF, "not a pan")).toEqual({ ok: true, pan: null });
  });

  it("takes a valid PAN while 80G is on, in its stored form", () => {
    expect(readPanInput(ON, " abcpe 1234 f ")).toEqual({
      ok: true,
      pan: "ABCPE1234F",
    });
  });

  it("leaves the PAN optional while 80G is on", () => {
    expect(readPanInput(ON, undefined)).toEqual({ ok: true, pan: null });
    expect(readPanInput(ON, null)).toEqual({ ok: true, pan: null });
    expect(readPanInput(ON, "   ")).toEqual({ ok: true, pan: null });
  });

  it("refuses an invalid PAN while 80G is on", () => {
    expect(readPanInput(ON, "ABCDE1234F")).toEqual({
      ok: false,
      error: "pan_invalid",
    });
  });
});

describe("taxExemptionFor", () => {
  /** Rs 25,000 by cheque with a PAN, inside the registration. */
  const CHEQUE: DonationForTaxExemption = {
    method: "cheque",
    amountMinor: 2_500_000n,
    donatedOn: "2027-01-15",
    pan: parsePan("ABCPE1234F"),
  };

  it("gives the block, frozen as the receipt will print it", () => {
    expect(taxExemptionFor(ON, CHEQUE)).toEqual({
      exempt: true,
      block: {
        wording: "DRAFT, confirm with accountant: this donation qualifies.",
        registrationNumber: "DRAFT-REG-0001",
        validUntil: "2029-03-31",
        panMasked: "XXXXXX234F",
      },
    });
  });

  it("trims the facts and prints no end date when none is set", () => {
    const decision = taxExemptionFor(
      {
        ...ON,
        wording: "  Exempt wording.\n",
        registrationNumber: " REG-9 ",
        validUntil: "",
      },
      CHEQUE
    );
    expect(decision).toEqual({
      exempt: true,
      block: {
        wording: "Exempt wording.",
        registrationNumber: "REG-9",
        validUntil: null,
        panMasked: "XXXXXX234F",
      },
    });
  });

  it.each(["gateway", "bank_transfer", "cheque"] as const)(
    "gives it for %s whatever the amount",
    (method) => {
      const decision = taxExemptionFor(ON, {
        ...CHEQUE,
        method,
        amountMinor: 100_000_000n,
      });
      expect(decision.exempt).toBe(true);
    }
  );

  it.each<[string, TaxExemptionSettings, DonationForTaxExemption, string]>([
    ["80G is off", OFF, CHEQUE, "not_registered"],
    [
      "80G is off with the facts kept ready",
      { ...ON, has80G: false },
      CHEQUE,
      "not_registered",
    ],
    [
      "the settings are incomplete",
      { ...ON, wording: "" },
      CHEQUE,
      "settings_incomplete",
    ],
    [
      "the end date is malformed",
      { ...ON, validUntil: "2029-02-30" },
      CHEQUE,
      "settings_incomplete",
    ],
    ["the donor gave no PAN", ON, { ...CHEQUE, pan: null }, "no_pan"],
    [
      "the donation came after the registration ended",
      { ...ON, validUntil: "2027-01-14" },
      CHEQUE,
      "registration_expired",
    ],
    [
      "cash over the limit",
      ON,
      {
        ...CHEQUE,
        method: "cash",
        amountMinor: CASH_EXEMPTION_LIMIT_MINOR + 1n,
      },
      "cash_over_limit",
    ],
  ])("gives none when %s", (_, settings, donation, reason) => {
    expect(taxExemptionFor(settings, donation)).toEqual({
      exempt: false,
      reason,
    });
  });

  it("covers a donation on the registration's last day", () => {
    const decision = taxExemptionFor(
      { ...ON, validUntil: "2027-01-15" },
      CHEQUE
    );
    expect(decision.exempt).toBe(true);
  });

  it("caps cash at Rs 2,000, that amount included", () => {
    expect(CASH_EXEMPTION_LIMIT_MINOR).toBe(200_000n);
    const cash = { ...CHEQUE, method: "cash" as const };
    expect(taxExemptionFor(ON, { ...cash, amountMinor: 200_000n }).exempt).toBe(
      true
    );
    expect(taxExemptionFor(ON, { ...cash, amountMinor: 200_001n }).exempt).toBe(
      false
    );
  });

  it.each(["", "15-01-2027", "2027-02-30"])(
    "throws on a donation date of %j",
    (donatedOn) => {
      expect(() => taxExemptionFor(ON, { ...CHEQUE, donatedOn })).toThrow(
        RangeError
      );
    }
  );
});
