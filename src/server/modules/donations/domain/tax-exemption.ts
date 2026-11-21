// Tax-exemption ("80G") receipts (#108). FOA starts without an income-tax
// exemption, so receipts carry no exemption wording. Once FOA holds one, a
// super admin turns `org.has80G` on and fills in the wording and the
// registration number the accountant supplies. The law was renamed (now
// the Income-tax Act 2025), so no section number or wording is written
// here: it all comes from the settings.
//
// This file holds the rules: which settings may be saved together, when a
// donor is asked for their PAN, and whether one receipt gets the exemption
// block. Pure: no database, no clock.
//
// Loads under plain Node (the seed script reads it): relative imports only.

import { maskPan, parsePan, type Pan } from "./pan";

/** The organisation-fact settings this feature reads (#62's catalogue). */
export type TaxExemptionSettings = {
  /** `org.has80G`: FOA holds a tax exemption and may say so on receipts. */
  has80G: boolean;
  /** `org.taxExemption.wording`: printed on exempt receipts as written. */
  wording: string;
  /** `org.taxExemption.registrationNumber`: printed with the wording. */
  registrationNumber: string;
  /**
   * `org.taxExemption.validUntil`: the last day the exemption covers, as
   * `YYYY-MM-DD`, or "" when the registration states no end.
   */
  validUntil: string;
};

/** Why these settings can't be saved together. */
export type TaxExemptionSettingsProblem =
  /** 80G is on and there is no wording to print. */
  | "wording_required"
  /** 80G is on and there is no registration number to print. */
  | "registration_number_required"
  /** The end date isn't "" or a real `YYYY-MM-DD` day. */
  | "valid_until_invalid";

const isBlank = (text: string) => text.trim() === "";

/** Whether `text` is a real calendar day written `YYYY-MM-DD`. */
function isIsoDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * What stops these settings being saved together. The settings screen runs
 * it on the values a change would leave, so 80G can't be turned on, and the
 * wording can't be cleared while it is on, with a fact missing.
 */
export function checkTaxExemptionSettings(
  settings: TaxExemptionSettings
): TaxExemptionSettingsProblem[] {
  const problems: TaxExemptionSettingsProblem[] = [];
  if (settings.has80G && isBlank(settings.wording)) {
    problems.push("wording_required");
  }
  if (settings.has80G && isBlank(settings.registrationNumber)) {
    problems.push("registration_number_required");
  }
  if (settings.validUntil !== "" && !isIsoDate(settings.validUntil)) {
    problems.push("valid_until_invalid");
  }
  return problems;
}

/**
 * Whether donation forms ask for the donor's PAN. Only while 80G is on and
 * complete: a PAN is collected for one purpose, the exemption block.
 */
export function asksForPan(settings: TaxExemptionSettings): boolean {
  return settings.has80G && checkTaxExemptionSettings(settings).length === 0;
}

export type PanInput =
  | { ok: true; pan: Pan | null }
  | { ok: false; error: "pan_invalid" };

/**
 * The PAN to store with a donation, from what a form sent. While the form
 * doesn't ask (80G off), whatever came is dropped, so no PAN is ever
 * stored then. While it asks, the PAN is optional: a donor who leaves it
 * out gets a receipt without the exemption block.
 */
export function readPanInput(
  settings: TaxExemptionSettings,
  input: string | null | undefined
): PanInput {
  if (!asksForPan(settings) || input == null || isBlank(input)) {
    return { ok: true, pan: null };
  }
  const pan = parsePan(input);
  return pan ? { ok: true, pan } : { ok: false, error: "pan_invalid" };
}

/**
 * The most cash one donation may be and still get the exemption block:
 * Rs 2,000, in paise. A larger cash gift gets a plain receipt. The
 * accountant confirms the limit under the 2025 Act (HR-47).
 */
export const CASH_EXEMPTION_LIMIT_MINOR = 200_000n;

/** A donation as the exemption decision needs it. */
export type DonationForTaxExemption = {
  /** How the money came: Razorpay, or one of the offline methods. */
  method: "gateway" | "bank_transfer" | "cheque" | "cash";
  amountMinor: bigint;
  /**
   * The day the money was given, `YYYY-MM-DD` in IST: the capture day
   * online, the day finance received it offline.
   */
  donatedOn: string;
  /** From `readPanInput`; null when the donor gave none. */
  pan: Pan | null;
};

/** What an exempt receipt prints, frozen into its snapshot. */
export type TaxExemptionBlock = {
  wording: string;
  registrationNumber: string;
  /** The registration's last day, or null when it states none. */
  validUntil: string | null;
  /** Never the full PAN (./pan.ts). */
  panMasked: string;
};

export type NoTaxExemptionReason =
  /** 80G is off: FOA's starting point. */
  | "not_registered"
  /** 80G is on but a fact is missing or malformed. */
  | "settings_incomplete"
  /** The donor gave no PAN. */
  | "no_pan"
  /** The money came after the registration's last day. */
  | "registration_expired"
  /** Cash above CASH_EXEMPTION_LIMIT_MINOR. */
  | "cash_over_limit";

export type TaxExemptionDecision =
  | { exempt: true; block: TaxExemptionBlock }
  | { exempt: false; reason: NoTaxExemptionReason };

/**
 * Whether one receipt carries the exemption block, decided once when the
 * receipt is issued and frozen with it: turning 80G on or off, or editing
 * the wording, never changes a receipt already issued.
 */
export function taxExemptionFor(
  settings: TaxExemptionSettings,
  donation: DonationForTaxExemption
): TaxExemptionDecision {
  if (!isIsoDate(donation.donatedOn)) {
    throw new RangeError(
      `Donation date must be YYYY-MM-DD, got ${JSON.stringify(donation.donatedOn)}`
    );
  }
  if (!settings.has80G) return { exempt: false, reason: "not_registered" };
  if (checkTaxExemptionSettings(settings).length > 0) {
    return { exempt: false, reason: "settings_incomplete" };
  }
  if (!donation.pan) return { exempt: false, reason: "no_pan" };
  // Both are YYYY-MM-DD, so string order is date order.
  if (settings.validUntil !== "" && donation.donatedOn > settings.validUntil) {
    return { exempt: false, reason: "registration_expired" };
  }
  if (
    donation.method === "cash" &&
    donation.amountMinor > CASH_EXEMPTION_LIMIT_MINOR
  ) {
    return { exempt: false, reason: "cash_over_limit" };
  }
  return {
    exempt: true,
    block: {
      wording: settings.wording.trim(),
      registrationNumber: settings.registrationNumber.trim(),
      validUntil: settings.validUntil === "" ? null : settings.validUntil,
      panMasked: maskPan(donation.pan),
    },
  };
}
