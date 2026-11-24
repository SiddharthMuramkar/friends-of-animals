// What an applicant tells FOA: the areas they'd like to help with and when
// they're free. Parsed here so the apply form, the use case and the stored
// row agree, and normalised (sorted, no repeats) so two applications with
// the same answers store the same value.
//
// Pure: loads under plain Node, so the schema can build its pgEnum from
// VOLUNTEER_INTERESTS.

import { z } from "zod";

export const VOLUNTEER_INTERESTS = [
  "technology",
  "content",
  "outreach",
  "competition_management",
  "social_media",
  "community_building",
] as const;

export type VolunteerInterest = (typeof VOLUNTEER_INTERESTS)[number];

/** At least one interest; each kept once, in the catalogue's order. */
export const volunteerInterestsSchema = z
  .array(z.enum(VOLUNTEER_INTERESTS))
  .min(1)
  .max(VOLUNTEER_INTERESTS.length * 2)
  .transform((picked) =>
    VOLUNTEER_INTERESTS.filter((interest) => picked.includes(interest))
  );

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const DAY_PARTS = ["morning", "afternoon", "evening"] as const;

export type AvailabilitySlot = {
  day: (typeof WEEKDAYS)[number];
  part: (typeof DAY_PARTS)[number];
};

export const AVAILABILITY_NOTE_MAX_LENGTH = 280;

const slotSchema = z.object({
  day: z.enum(WEEKDAYS),
  part: z.enum(DAY_PARTS),
});

function slotOrder(slot: AvailabilitySlot): number {
  return (
    WEEKDAYS.indexOf(slot.day) * DAY_PARTS.length + DAY_PARTS.indexOf(slot.part)
  );
}

/**
 * The weekly slots the applicant is free in, plus an optional note
 * ("school holidays only"). Stored as jsonb on the application.
 */
export const availabilitySchema = z
  .object({
    slots: z
      .array(slotSchema)
      .min(1)
      .max(WEEKDAYS.length * DAY_PARTS.length * 2),
    note: z
      .string()
      .trim()
      .max(AVAILABILITY_NOTE_MAX_LENGTH)
      .nullish()
      .transform((note) => (note ? note : null)),
  })
  .transform(({ slots, note }) => {
    const byOrder = new Map<number, AvailabilitySlot>();
    for (const slot of slots) byOrder.set(slotOrder(slot), slot);
    const sorted = [...byOrder.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, slot]) => ({ day: slot.day, part: slot.part }));
    return { slots: sorted, note };
  });

export type Availability = z.output<typeof availabilitySchema>;

export const DECLINE_REASON_MAX_LENGTH = 500;

/** Why a community manager declined; the applicant is told. */
export const declineReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(DECLINE_REASON_MAX_LENGTH);
