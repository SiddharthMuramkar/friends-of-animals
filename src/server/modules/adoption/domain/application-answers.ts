// What an adoption application asks, stored as the application's `answers`
// jsonb. Phone and address are separate, encrypted columns, so they never
// appear here. The questions and limits are defaults until FOA's
// coordinator asks for others.
//
// Loads under plain Node.

import { z } from "zod";

export const HOME_TYPES = [
  "apartment",
  "independent_house",
  "shared_accommodation",
  "other",
] as const;

export type HomeType = (typeof HOME_TYPES)[number];

export const applicationAnswersSchema = z.strictObject({
  homeType: z.enum(HOME_TYPES),
  hasOutdoorSpace: z.boolean(),
  /** Empty when there are none. */
  otherAnimals: z.string().trim().max(500),
  experience: z.string().trim().min(1).max(1000),
  availability: z.string().trim().min(1).max(500),
});

export type ApplicationAnswers = z.infer<typeof applicationAnswersSchema>;
