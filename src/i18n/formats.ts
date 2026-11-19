import type { Formats } from "next-intl";

/**
 * Shared ICU formats. Dates use `long`, "18 November 2026": the full month
 * name reads more easily for young readers than "18 Nov 2026". Rupees use
 * Indian grouping.
 */
export const formats = {
  dateTime: {
    short: { day: "2-digit", month: "short", year: "numeric" },
    long: { day: "numeric", month: "long", year: "numeric" },
    // A deadline with its time: "15 January 2027 at 11:59 pm IST".
    longDateTime: {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
      timeZoneName: "short",
    },
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
    // ₹1,24,000 (no paise). Render amounts in the display face: its stack
    // maps ₹ to a system font (globals.css), as Inter's latin file lacks it.
    inr: { style: "currency", currency: "INR", maximumFractionDigits: 0 },
    inrExact: { style: "currency", currency: "INR" },
  },
  list: { and: { style: "long", type: "conjunction" } },
} satisfies Formats;

export const LOCALE = "en-IN";
export const TIME_ZONE = "Asia/Kolkata";
