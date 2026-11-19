import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";

import { formats, LOCALE, TIME_ZONE } from "./formats";

const format = createFormatter({
  locale: LOCALE,
  timeZone: TIME_ZONE,
  formats,
});

describe("date formats", () => {
  it("writes dates with the full month name", () => {
    expect(format.dateTime(new Date("2026-11-18T12:00:00+05:30"), "long")).toBe(
      "18 November 2026"
    );
  });

  it("gives deadlines their time in Indian Standard Time", () => {
    const closes = format.dateTime(
      new Date("2027-01-15T23:59:00+05:30"),
      "longDateTime"
    );
    expect(closes).toMatch(/^15 January 2027\b/);
    expect(closes).toMatch(/11:59\spm/i);
    expect(closes).toMatch(/IST$/);
  });

  it("keeps IST even when the server runs in another time zone", () => {
    const utc = createFormatter({ locale: LOCALE, timeZone: "UTC", formats });
    expect(
      utc.dateTime(new Date("2026-11-01T09:00:00+05:30"), "longDateTime")
    ).toMatch(/^1 November 2026\b.*9:00\sam IST$/i);
  });
});
