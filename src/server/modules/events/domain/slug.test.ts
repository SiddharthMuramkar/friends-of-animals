import { describe, expect, it } from "vitest";

import { EVENT_SLUG_PATTERN, eventSlugCandidates } from "./slug";

// 07:00 IST on 13 February 2027 is 01:30 UTC the same day; 02:00 IST on
// 14 February is still 13 February in UTC.
const saturdayMorning = new Date("2027-02-13T01:30:00.000Z");
const earlySunday = new Date("2027-02-13T20:30:00.000Z");

describe("eventSlugCandidates", () => {
  it("tries the title, then the title with the IST date, then numbered", () => {
    expect(
      eventSlugCandidates("Beach Clean-up at Juhu!", saturdayMorning)
    ).toEqual([
      "beach-clean-up-at-juhu",
      "beach-clean-up-at-juhu-2027-02-13",
      "beach-clean-up-at-juhu-2027-02-13-2",
      "beach-clean-up-at-juhu-2027-02-13-3",
      "beach-clean-up-at-juhu-2027-02-13-4",
    ]);
  });

  it("dates the slug by the day in India, not in UTC", () => {
    expect(eventSlugCandidates("Night walk", earlySunday)[1]).toBe(
      "night-walk-2027-02-14"
    );
  });

  it("drops accents and punctuation", () => {
    expect(
      eventSlugCandidates("Café  &  Paws — Pune", saturdayMorning)[0]
    ).toBe("cafe-paws-pune");
  });

  it("uses 'event' and the date when the title has no usable letters", () => {
    expect(eventSlugCandidates("पशु मेला", saturdayMorning)).toEqual([
      "event-2027-02-13",
      "event-2027-02-13-2",
      "event-2027-02-13-3",
      "event-2027-02-13-4",
      "event-2027-02-13-5",
    ]);
  });

  it("keeps long titles within 80 characters, cut at a word", () => {
    const title =
      "A very long title about a weekend adoption drive with grooming stalls and a vet camp for street dogs";
    for (const slug of eventSlugCandidates(title, saturdayMorning)) {
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug).toMatch(EVENT_SLUG_PATTERN);
      expect(slug).not.toMatch(/--|-$/);
    }
    expect(eventSlugCandidates(title, saturdayMorning)[1]).toMatch(
      /-2027-02-13$/
    );
  });

  it("makes only slugs the public route accepts", () => {
    for (const title of ["Go", "A", "Beach clean-up", "!!!", "x".repeat(200)]) {
      for (const slug of eventSlugCandidates(title, saturdayMorning)) {
        expect(slug).toMatch(EVENT_SLUG_PATTERN);
      }
    }
  });

  it("gives distinct candidates", () => {
    const slugs = eventSlugCandidates("Beach clean-up", saturdayMorning);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
