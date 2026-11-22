import { describe, expect, it } from "vitest";

import {
  checkOfflinePayment,
  istDate,
  normaliseOfflineReference,
  OFFLINE_RECEIPT_LOOKBACK_DAYS,
  type OfflinePaymentInput,
} from "./offline-payment";

// 10:00 IST on 15 January 2027.
const NOW = new Date("2027-01-15T04:30:00.000Z");

const valid: OfflinePaymentInput = {
  method: "cheque",
  reference: "004512",
  amountMinor: 1_500_00n,
  receivedOn: "2027-01-14",
};

const check = (
  input: Partial<OfflinePaymentInput>,
  batchAmountMinor = 1_500_00n
) =>
  checkOfflinePayment({ ...valid, ...input }, { batchAmountMinor, now: NOW });

describe("istDate()", () => {
  it("is the calendar date in India, which runs 5 h 30 min ahead of UTC", () => {
    expect(istDate(new Date("2027-01-14T18:29:59.999Z"))).toBe("2027-01-14");
    expect(istDate(new Date("2027-01-14T18:30:00.000Z"))).toBe("2027-01-15");
  });
});

describe("normaliseOfflineReference()", () => {
  it.each([
    ["004512", "004512"],
    [" 004 512 ", "004512"],
    ["００４５１２", "004512"],
  ])("takes cheque number %j as %j", (raw, reference) => {
    expect(normaliseOfflineReference("cheque", raw)).toBe(reference);
  });

  it.each(["4512", "0045123", "00451a", "", "004-512"])(
    "refuses cheque number %j: a cheque number is 6 digits",
    (raw) => {
      expect(normaliseOfflineReference("cheque", raw)).toBeNull();
    }
  );

  it.each([
    ["sbinn52027011500001", "SBINN52027011500001"],
    ["HDFC-R5-2027-0115-0000-1234", "HDFCR52027011500001234"],
    ["7012 3456 7890", "701234567890"],
  ])("takes transfer reference %j as %j", (raw, reference) => {
    expect(normaliseOfflineReference("bank_transfer", raw)).toBe(reference);
  });

  it.each(["1234567", "A".repeat(36), "UTR#12345678", ""])(
    "refuses transfer reference %j: 8 to 35 letters and digits",
    (raw) => {
      expect(normaliseOfflineReference("bank_transfer", raw)).toBeNull();
    }
  );

  it.each([
    ["foa/2027/0012", "FOA/2027/0012"],
    ["  R-17   book 3 ", "R-17 BOOK 3"],
    ["7", "7"],
  ])("takes cash receipt %j as %j", (raw, reference) => {
    expect(normaliseOfflineReference("cash", raw)).toBe(reference);
  });

  it.each(["", "   ", "/2027", "R".repeat(41), "receipt #12", "<b>1</b>"])(
    "refuses cash receipt %j",
    (raw) => {
      expect(normaliseOfflineReference("cash", raw)).toBeNull();
    }
  );
});

describe("checkOfflinePayment()", () => {
  it("accepts a payment for exactly the batch amount, received today or earlier", () => {
    expect(check({ reference: " 004 512 " })).toEqual({
      ok: true,
      payment: {
        method: "cheque",
        reference: "004512",
        amountMinor: 1_500_00n,
        receivedOn: "2027-01-14",
      },
    });
    expect(check({ receivedOn: "2027-01-15" }).ok).toBe(true);
  });

  it("refuses an amount other than the batch's: no partial or over payments", () => {
    expect(check({ amountMinor: 1_499_99n })).toEqual({
      ok: false,
      errors: { amountMinor: "amount_mismatch" },
    });
    expect(check({ amountMinor: 1_500_01n })).toEqual({
      ok: false,
      errors: { amountMinor: "amount_mismatch" },
    });
  });

  it.each([0n, -1n])("refuses an amount of %s paise", (amountMinor) => {
    expect(check({ amountMinor })).toEqual({
      ok: false,
      errors: { amountMinor: "amount_invalid" },
    });
  });

  it("refuses money for a free batch: there is nothing to pay", () => {
    expect(check({ amountMinor: 100n }, 0n)).toEqual({
      ok: false,
      errors: { amountMinor: "amount_mismatch" },
    });
  });

  it.each(["2027-02-30", "2027-1-14", "14/01/2027", "", "2027-01-14T00:00"])(
    "refuses receipt date %j: not a calendar date",
    (receivedOn) => {
      expect(check({ receivedOn })).toEqual({
        ok: false,
        errors: { receivedOn: "received_on_invalid" },
      });
    }
  );

  it("refuses a receipt date after today in India", () => {
    expect(check({ receivedOn: "2027-01-16" })).toEqual({
      ok: false,
      errors: { receivedOn: "received_in_future" },
    });
  });

  it("uses the Indian date at the instant: 23:59 IST still counts as that day", () => {
    const lateEvening = new Date("2027-01-15T18:29:00.000Z");
    expect(
      checkOfflinePayment(
        { ...valid, receivedOn: "2027-01-15" },
        { batchAmountMinor: valid.amountMinor, now: lateEvening }
      ).ok
    ).toBe(true);
    expect(
      checkOfflinePayment(
        { ...valid, receivedOn: "2027-01-16" },
        { batchAmountMinor: valid.amountMinor, now: lateEvening }
      ).ok
    ).toBe(false);
  });

  it(`refuses a receipt date more than ${OFFLINE_RECEIPT_LOOKBACK_DAYS} days back, a likely typo`, () => {
    // 15 January 2027 minus 366 days is 14 January 2026.
    expect(check({ receivedOn: "2026-01-14" }).ok).toBe(true);
    expect(check({ receivedOn: "2026-01-13" })).toEqual({
      ok: false,
      errors: { receivedOn: "received_too_long_ago" },
    });
  });

  it("reports every field that is wrong at once, for the form", () => {
    expect(
      check({ reference: "12", amountMinor: 0n, receivedOn: "2027-13-01" })
    ).toEqual({
      ok: false,
      errors: {
        reference: "reference_invalid",
        amountMinor: "amount_invalid",
        receivedOn: "received_on_invalid",
      },
    });
  });

  it("checks the reference by the method chosen", () => {
    expect(check({ method: "bank_transfer", reference: "004512" })).toEqual({
      ok: false,
      errors: { reference: "reference_invalid" },
    });
    expect(
      check({ method: "bank_transfer", reference: "sbinn52027011500001" })
    ).toMatchObject({
      ok: true,
      payment: { method: "bank_transfer", reference: "SBINN52027011500001" },
    });
    expect(check({ method: "cash", reference: "foa/2027/0012" })).toMatchObject(
      { ok: true, payment: { method: "cash", reference: "FOA/2027/0012" } }
    );
  });
});
