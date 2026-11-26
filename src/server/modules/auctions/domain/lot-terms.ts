// A lot's price and dates (#131). Prices are bigint paise in INR; the base
// price is where bidding starts and the reserve, never disclosed, is the
// least the lot sells for. Checked when a lot is created and again when it
// is scheduled, since time passes while it is a draft.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/** Lots are priced in rupees at launch. */
export const LOT_CURRENCY = "INR";

/** The largest value a Postgres bigint column holds. */
const BIGINT_MAX = 9_223_372_036_854_775_807n;

export type LotTerms = {
  basePricePaise: bigint;
  reservePricePaise: bigint;
  opensAt: Date;
  closesAt: Date;
};

/** What can be wrong with lot terms, in the order they are reported. */
export const LOT_TERMS_ERRORS = [
  "base_price_not_positive",
  "reserve_below_base",
  "price_too_large",
  "invalid_date",
  "opens_in_past",
  "closes_before_opens",
] as const;

export type LotTermsError = (typeof LOT_TERMS_ERRORS)[number];

export type LotTermsCheck =
  | { ok: true }
  | { ok: false; errors: LotTermsError[] };

/** Whether `terms` may be saved or scheduled at `now`. */
export function validateLotTerms(terms: LotTerms, now: Date): LotTermsCheck {
  const found = new Set<LotTermsError>();
  const { basePricePaise: base, reservePricePaise: reserve } = terms;
  if (base <= 0n) found.add("base_price_not_positive");
  if (reserve < base) found.add("reserve_below_base");
  if (base > BIGINT_MAX || reserve > BIGINT_MAX) found.add("price_too_large");

  const opens = terms.opensAt.getTime();
  const closes = terms.closesAt.getTime();
  if (Number.isNaN(opens) || Number.isNaN(closes)) {
    found.add("invalid_date");
  } else {
    if (opens <= now.getTime()) found.add("opens_in_past");
    if (closes <= opens) found.add("closes_before_opens");
  }

  const errors = LOT_TERMS_ERRORS.filter((error) => found.has(error));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
