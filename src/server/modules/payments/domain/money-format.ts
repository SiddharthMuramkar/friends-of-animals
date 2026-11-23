// Paise as a person reads rupees, in Indian grouping with the paise:
// 150000n → "₹1,500.00". Formatted from a decimal string, so no amount
// passes through a float. Pure; plain Node.

import { formats, LOCALE } from "../../../../i18n/formats";

const inr = new Intl.NumberFormat(LOCALE, formats.number.inrExact);

/** A captured payment in the currency recorded by the gateway. */
export function formatCapturedAmount(
  amountMinor: bigint,
  currency: string
): string {
  if (currency === "INR") return formatPaise(amountMinor);
  // A malformed currency can itself be why a payment needs review.
  if (!/^[A-Z]{3}$/.test(currency)) return `${amountMinor} (${currency})`;
  const formatter = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "code",
  });
  return formatMinorUnits(
    amountMinor,
    formatter,
    formatter.resolvedOptions().maximumFractionDigits!
  );
}

export function formatPaise(paise: bigint): string {
  return formatMinorUnits(paise, inr, 2);
}

function formatMinorUnits(
  amountMinor: bigint,
  formatter: Intl.NumberFormat,
  digits: number
): string {
  const sign = amountMinor < 0n ? "-" : "";
  const magnitude = amountMinor < 0n ? -amountMinor : amountMinor;
  const scale = 10n ** BigInt(digits);
  const whole = `${sign}${magnitude / scale}`;
  if (digits === 0) return formatter.format(whole as `${number}`);
  const fraction = (magnitude % scale).toString().padStart(digits, "0");
  return formatter.format(`${whole}.${fraction}` as `${number}`);
}
