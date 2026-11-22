// Offline payments (#79): money FOA received by cheque, bank transfer or
// cash, which finance records against a payment batch. Recording one has the
// same effect as an online capture, so these checks run before anything is
// written: a reference that fits the method, exactly the batch's amount, and
// a receipt date that can be true. Pure; no imports, no clock (the caller
// passes `now`).

export const OFFLINE_PAYMENT_METHODS = [
  "cheque",
  "bank_transfer",
  "cash",
] as const;

export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

/** What finance typed, after the form's schema has parsed its shape. */
export type OfflinePaymentInput = {
  method: OfflinePaymentMethod;
  /** Cheque number, bank transfer reference (UTR) or FOA cash receipt. */
  reference: string;
  /** Bigint paise, like every amount (#55). */
  amountMinor: bigint;
  /** The calendar date in India the money arrived, `YYYY-MM-DD`. */
  receivedOn: string;
};

export type OfflinePaymentErrors = {
  reference?: "reference_invalid";
  amountMinor?: "amount_invalid" | "amount_mismatch";
  receivedOn?:
    | "received_on_invalid"
    | "received_in_future"
    | "received_too_long_ago";
};

export type OfflinePaymentCheck =
  | { ok: true; payment: OfflinePaymentInput }
  | { ok: false; errors: OfflinePaymentErrors };

/**
 * How far back a receipt date may go. Money can arrive before finance gets
 * to it, but a date over a year old is far likelier a typo (2016 for 2026).
 */
export const OFFLINE_RECEIPT_LOOKBACK_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
/** India Standard Time is UTC+05:30 all year: there is no daylight saving. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The calendar date in India at `at`, as `YYYY-MM-DD`. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The UTC midnight of a `YYYY-MM-DD` date, or null if there's no such day. */
function parseCalendarDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const time = Date.UTC(year, month - 1, day);
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** Each method's reference, after normalising, must match its pattern. */
const REFERENCE_RULES: Readonly<
  Record<OfflinePaymentMethod, { strip: RegExp | null; pattern: RegExp }>
> = {
  // A CTS cheque number: the 6 digits printed first in the MICR band.
  cheque: { strip: /\s+/g, pattern: /^\d{6}$/ },
  // Banks print UTRs and IMPS or UPI references in groups; keep the
  // characters only. Lengths differ by rail, so the bounds are generous.
  bank_transfer: { strip: /[\s-]+/g, pattern: /^[A-Z0-9]{8,35}$/ },
  // FOA's own receipt book number, e.g. FOA/2027/0012.
  cash: { strip: null, pattern: /^[A-Z0-9][A-Z0-9 /-]{0,39}$/ },
};

/**
 * The reference as it is stored and compared: full-width characters folded,
 * upper-cased, and the separators the method ignores removed. Null if it
 * doesn't fit the method.
 */
export function normaliseOfflineReference(
  method: OfflinePaymentMethod,
  raw: string
): string | null {
  const rule = REFERENCE_RULES[method];
  const cleaned = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  const upper = cleaned.toUpperCase();
  const reference = rule.strip ? upper.replace(rule.strip, "") : upper;
  return rule.pattern.test(reference) ? reference : null;
}

/**
 * Checks an offline payment against the batch it pays for. Every wrong
 * field is reported at once, so the form can mark them all. The amount must
 * be exactly the batch's: a partial or over payment isn't recorded here.
 */
export function checkOfflinePayment(
  input: OfflinePaymentInput,
  context: { batchAmountMinor: bigint; now: Date }
): OfflinePaymentCheck {
  const errors: OfflinePaymentErrors = {};

  const reference = normaliseOfflineReference(input.method, input.reference);
  if (reference === null) errors.reference = "reference_invalid";

  if (input.amountMinor <= 0n) errors.amountMinor = "amount_invalid";
  else if (input.amountMinor !== context.batchAmountMinor) {
    errors.amountMinor = "amount_mismatch";
  }

  const received = parseCalendarDate(input.receivedOn);
  const today = parseCalendarDate(istDate(context.now));
  if (received === null || today === null) {
    errors.receivedOn = "received_on_invalid";
  } else if (received > today) {
    errors.receivedOn = "received_in_future";
  } else if (received < today - OFFLINE_RECEIPT_LOOKBACK_DAYS * DAY_MS) {
    errors.receivedOn = "received_too_long_ago";
  }

  if (reference === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, payment: { ...input, reference } };
}
