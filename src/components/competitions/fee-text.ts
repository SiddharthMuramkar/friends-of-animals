// The words for one route's fee on the public competition page: "₹1,500",
// "₹25,000.50", "Free" or "To be announced". Whole rupees drop the paise.
//
// Pure: the caller passes next-intl's translator and formatter, so the
// same words render on the server and in tests.

import type { FeeLine } from "@/server/modules/competitions/domain/fees";

export type FeeTextIntl = {
  t: (key: "free" | "notSet") => string;
  format: {
    number(value: bigint, format: "inr"): string;
  };
};

/** One route's fee as a visitor reads it. */
export function feeText(line: FeeLine, intl: FeeTextIntl): string {
  switch (line.kind) {
    case "free":
      return intl.t("free");
    case "not_set":
      return intl.t("notSet");
    case "amount": {
      const rupees = line.paise / 100n;
      const paise = line.paise % 100n;
      if (paise === 0n) return intl.format.number(rupees, "inr");
      // Intl formats bigints exactly but not fractions of them, so the
      // paise are written onto the formatted rupees.
      const whole = intl.format.number(rupees, "inr");
      return `${whole}.${paise.toString().padStart(2, "0")}`;
    }
  }
}
