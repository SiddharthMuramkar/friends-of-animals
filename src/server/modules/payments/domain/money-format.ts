// Paise as a person reads rupees, in Indian grouping with the paise:
// 150000n → "₹1,500.00". Formatted from a decimal string, so no amount
// passes through a float. Pure; plain Node.

import { formats, LOCALE } from "../../../../i18n/formats";

const inr = new Intl.NumberFormat(LOCALE, formats.number.inrExact);

export function formatPaise(paise: bigint): string {
  const sign = paise < 0n ? "-" : "";
  const magnitude = paise < 0n ? -paise : paise;
  const rupees = magnitude / 100n;
  const rest = (magnitude % 100n).toString().padStart(2, "0");
  return inr.format(`${sign}${rupees}.${rest}` as `${number}`);
}
