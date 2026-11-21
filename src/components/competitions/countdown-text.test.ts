import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { formats, LOCALE, TIME_ZONE } from "@/i18n/formats";
import { messages } from "@/i18n/messages";

import { countdownText } from "./countdown-text";

// Registration opens 10:00 IST on 1 Feb and closes 23:59 IST on 28 Feb.
const OPEN = new Date("2027-02-01T04:30:00.000Z");
const CLOSE = new Date("2027-02-28T18:29:00.000Z");
const DAY = 86_400_000;

// The server may run in UTC; the countdown must still read in IST.
const intl = {
  t: createTranslator({
    locale: LOCALE,
    messages,
    namespace: "competitionStatus.countdown",
  }),
  format: createFormatter({ locale: LOCALE, timeZone: "UTC", formats }),
};

describe("countdownText", () => {
  it("gives the opening time in IST and how far off it is", () => {
    expect(
      countdownText(
        { kind: "scheduled", to: "registration_open", at: OPEN },
        new Date(OPEN.getTime() - 3 * DAY),
        intl
      )
    ).toMatch(
      /^Registration opens 1 February 2027 at 10:00\sam IST \(in 3 days\)$/
    );
  });

  it("counts down to closing while registration is open", () => {
    expect(
      countdownText(
        { kind: "scheduled", to: "registration_closed", at: CLOSE },
        new Date(CLOSE.getTime() - 2 * 3_600_000),
        intl
      )
    ).toMatch(
      /^Registration closes 28 February 2027 at 11:59\spm IST \(in 2 hours\)$/
    );
  });

  it("says opening shortly, never a time in the past, once the move is due", () => {
    const text = countdownText(
      { kind: "due", to: "registration_open", at: OPEN },
      new Date(OPEN.getTime() + 90_000),
      intl
    );
    expect(text).toBe("Registration opening shortly");
  });

  it("says closing shortly once the closing move is due", () => {
    expect(
      countdownText(
        { kind: "due", to: "registration_closed", at: CLOSE },
        new Date(CLOSE.getTime() + 1),
        intl
      )
    ).toBe("Registration closing shortly");
  });

  it("shows nothing when no change is ahead", () => {
    expect(countdownText(null, OPEN, intl)).toBeNull();
  });

  it("keeps IST whatever zone the formatter was built for", () => {
    const ist = {
      ...intl,
      format: createFormatter({ locale: LOCALE, timeZone: TIME_ZONE, formats }),
    };
    const now = new Date(OPEN.getTime() - DAY);
    expect(
      countdownText(
        { kind: "scheduled", to: "registration_open", at: OPEN },
        now,
        ist
      )
    ).toBe(
      countdownText(
        { kind: "scheduled", to: "registration_open", at: OPEN },
        now,
        intl
      )
    );
  });
});
