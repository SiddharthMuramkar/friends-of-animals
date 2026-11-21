// What an authorised person sends to register an institution (#73), and
// the rules each field must meet. The schema's enums and checks are built
// from these constants, so this file loads under plain Node (drizzle-kit,
// the seed script): relative imports only, no "server-only".

import { z } from "zod";

import { parsePhoneNumber, type E164Phone } from "../../../lib/phone";

/** The kinds of institution FOA works with. */
export const INSTITUTION_TYPES = [
  "school",
  "college",
  "university",
  "other",
] as const;

export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

/** A district-wide programme is the largest FOA plans for. */
export const MAX_EXPECTED_PARTICIPANTS = 100_000;

const text = (max: number) => z.string().trim().min(1).max(max);

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/**
 * An Indian mobile number, typed any usual way, read as E.164. Messages to
 * the principal may go by SMS, which a landline can't receive.
 */
const mobile = z.string().transform((typed, context): E164Phone => {
  const parsed = parsePhoneNumber(typed);
  if (parsed.ok) return parsed.e164;
  context.addIssue({ code: "custom", message: parsed.reason });
  return z.NEVER;
});

export const registrationSchema = z.object({
  name: text(200),
  type: z.enum(INSTITUTION_TYPES),
  address: text(500),
  pinCode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/),
  city: text(100),
  state: text(100),
  country: text(100),
  contactEmail: email,
  contactPhone: mobile,
  principalName: text(200),
  principalEmail: email,
  principalPhone: mobile,
  expectedParticipants: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_EXPECTED_PARTICIPANTS),
});

/**
 * As the form sends it: the schema checks the type, and
 * `expectedParticipants` may still be text.
 */
export type RegisterInstitutionInput = Omit<
  z.input<typeof registrationSchema>,
  "type" | "expectedParticipants"
> & { type: string; expectedParticipants: number | string };

/** Checked, trimmed and normalised. */
export type Registration = z.output<typeof registrationSchema>;
