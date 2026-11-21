// Phone numbers as people type them, read into one canonical form (E.164) so
// "+91 98765 43210", "098765 43210" and "9876543210" are one number: one
// account, one blind index, one rate-limit bucket.
//
// Only Indian mobile numbers are accepted for now: sign-in codes go by SMS
// through MSG91 under India's DLT rules, and only a mobile can receive one.
// Numbers from other countries get their own reason, so the form can point
// those people to email sign-in.

/** A phone number in E.164 form, e.g. "+919876543210". */
export type E164Phone = string & { readonly __brand: "E164Phone" };

export type PhoneParseResult =
  | { ok: true; e164: E164Phone }
  | { ok: false; reason: "invalid" | "unsupported_country" };

const INVALID: PhoneParseResult = { ok: false, reason: "invalid" };

/**
 * Reads a phone number as a person types it: spaces, dashes, dots and
 * brackets are ignored, and +91, 0091, 91 or a trunk 0 may lead.
 */
export function parsePhoneNumber(input: string): PhoneParseResult {
  let digits = input.replace(/[\s\-.()]/g, "");
  if (digits.startsWith("+")) digits = `00${digits.slice(1)}`;
  if (digits.startsWith("00") && !digits.startsWith("0091")) {
    // E.164 allows at most 15 digits after the country's leading digit.
    return /^00[1-9]\d{6,14}$/.test(digits)
      ? { ok: false, reason: "unsupported_country" }
      : INVALID;
  }
  const national = digits.startsWith("0091")
    ? digits.slice(4)
    : digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  // Indian mobile numbers are ten digits starting 6 to 9; landlines and
  // other services can't receive a text.
  if (!/^[6-9]\d{9}$/.test(national)) return INVALID;
  return { ok: true, e164: `+91${national}` as E164Phone };
}

/** A number as people read it: "+91 98765 43210". */
export function formatPhoneNumber(phone: E164Phone): string {
  return `${phone.slice(0, 3)} ${phone.slice(3, 8)} ${phone.slice(8)}`;
}
