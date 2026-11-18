import type { Formats } from "next-intl";

/** Shared ICU formats: dates as "18 Nov 2026", rupees with Indian grouping. */
export const formats = {
  dateTime: {
    short: { day: "2-digit", month: "short", year: "numeric" },
    long: { day: "numeric", month: "long", year: "numeric" },
    dateTime: {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    },
  },
  number: {
    // ₹1,24,000 (no paise). Render amounts in the display face: ₹ is not in
    // Inter's latin subset.
    inr: { style: "currency", currency: "INR", maximumFractionDigits: 0 },
    inrExact: { style: "currency", currency: "INR" },
  },
  list: { and: { style: "long", type: "conjunction" } },
} satisfies Formats;

export const LOCALE = "en-IN";
export const TIME_ZONE = "Asia/Kolkata";
