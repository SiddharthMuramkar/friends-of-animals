import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_NOTE_MAX_LENGTH,
  availabilitySchema,
  DECLINE_REASON_MAX_LENGTH,
  declineReasonSchema,
  VOLUNTEER_INTERESTS,
  volunteerInterestsSchema,
} from "./application-input";

describe("volunteer interests", () => {
  it("lists the six areas FOA asks about", () => {
    expect(VOLUNTEER_INTERESTS).toEqual([
      "technology",
      "content",
      "outreach",
      "competition_management",
      "social_media",
      "community_building",
    ]);
  });

  it("keeps each interest once, in the catalogue's order", () => {
    expect(
      volunteerInterestsSchema.parse([
        "social_media",
        "technology",
        "social_media",
      ])
    ).toEqual(["technology", "social_media"]);
  });

  it("needs at least one interest and refuses unknown ones", () => {
    expect(volunteerInterestsSchema.safeParse([]).success).toBe(false);
    expect(volunteerInterestsSchema.safeParse(["fundraising"]).success).toBe(
      false
    );
  });
});

describe("availability", () => {
  it("sorts slots by weekday and part of the day and drops repeats", () => {
    expect(
      availabilitySchema.parse({
        slots: [
          { day: "saturday", part: "morning" },
          { day: "monday", part: "evening" },
          { day: "monday", part: "morning" },
          { day: "saturday", part: "morning" },
        ],
      })
    ).toEqual({
      slots: [
        { day: "monday", part: "morning" },
        { day: "monday", part: "evening" },
        { day: "saturday", part: "morning" },
      ],
      note: null,
    });
  });

  it("needs at least one slot", () => {
    expect(availabilitySchema.safeParse({ slots: [] }).success).toBe(false);
  });

  it("refuses an unknown day or part of the day", () => {
    expect(
      availabilitySchema.safeParse({
        slots: [{ day: "funday", part: "morning" }],
      }).success
    ).toBe(false);
    expect(
      availabilitySchema.safeParse({
        slots: [{ day: "monday", part: "night" }],
      }).success
    ).toBe(false);
  });

  it("trims the note, keeps it to 280 characters and stores an empty one as null", () => {
    const slots = [{ day: "sunday", part: "afternoon" }];
    expect(AVAILABILITY_NOTE_MAX_LENGTH).toBe(280);
    expect(
      availabilitySchema.parse({ slots, note: "  School holidays only  " }).note
    ).toBe("School holidays only");
    expect(availabilitySchema.parse({ slots, note: "   " }).note).toBeNull();
    expect(
      availabilitySchema.safeParse({ slots, note: "a".repeat(280) }).success
    ).toBe(true);
    expect(
      availabilitySchema.safeParse({ slots, note: "a".repeat(281) }).success
    ).toBe(false);
  });
});

describe("decline reason", () => {
  it("is required, trimmed and at most 500 characters", () => {
    expect(DECLINE_REASON_MAX_LENGTH).toBe(500);
    expect(declineReasonSchema.parse("  Not enough availability  ")).toBe(
      "Not enough availability"
    );
    expect(declineReasonSchema.safeParse("   ").success).toBe(false);
    expect(declineReasonSchema.safeParse("a".repeat(500)).success).toBe(true);
    expect(declineReasonSchema.safeParse("a".repeat(501)).success).toBe(false);
  });
});
