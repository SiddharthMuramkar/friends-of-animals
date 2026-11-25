// Paise as the donate pages print a whole-rupee amount: "1,00,000" (the
// labels add the ₹), keeping paise only when there are some.

import { formatPaise } from "@/server/modules/payments/domain/money-format";

export function rupeesText(paise: bigint): string {
  return formatPaise(paise).replace(/\.00$/, "").replace(/^₹/, "");
}
