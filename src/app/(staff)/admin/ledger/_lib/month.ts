import type { getFormatter } from "next-intl/server";

import { periodStart } from "@/server/modules/ledger/domain/period";

/** A ledger period as people say it: "December 2026". */
export function monthLabel(
  format: Awaited<ReturnType<typeof getFormatter>>,
  month: string
): string {
  return format.dateTime(periodStart(month), {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** A ledger period as a table heading: "Dec 26". */
export function shortMonthLabel(
  format: Awaited<ReturnType<typeof getFormatter>>,
  month: string
): string {
  return format.dateTime(periodStart(month), {
    month: "short",
    year: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
