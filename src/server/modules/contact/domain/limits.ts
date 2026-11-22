// The contact inbox's limits (#113): the longest value each form field and
// a staff note may hold, and the bot screen's minimum fill time. No zod
// here, so the schema, the pages and the form island's server action take
// them without the parsing code.
//
// Loads under plain Node (drizzle-kit, the seed script), so no
// "server-only" here.

/** Longest value each field of the contact form accepts, after trimming. */
export const CONTACT_FIELD_LIMITS = {
  name: 100,
  email: 254,
  organisation: 150,
  subject: 150,
  message: 5000,
} as const;

/** Longest staff note, after trimming. */
export const CONTACT_NOTE_MAX = 5000;

/** Faster than this from opening the form to sending it is a bot. */
export const MIN_FILL_MS = 3000;
