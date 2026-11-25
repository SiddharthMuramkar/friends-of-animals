// What a prospective adopter tells FOA when they apply (#130): how to reach
// them (an Indian mobile and a postal address), and a few answers about
// their home that help the coordinator and the organisation judge the
// match. Parsed here so the form, the use case and the stored row agree.
// Everything is plain text, shown escaped: no HTML.
//
// Pure: no I/O, no "server-only", no `@/` imports.

import { z } from "zod";

import { parsePhoneNumber } from "../../../../lib/phone";

export const HOME_TYPES = ["house", "flat", "other"] as const;
export type HomeType = (typeof HOME_TYPES)[number];

export const ADDRESS_MAX_LENGTH = 500;
export const ANSWER_MAX_LENGTH = 1000;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** The answers, stored together (encrypted) as one JSON value. */
export const adoptionAnswersSchema = z.strictObject({
  homeType: z.enum(HOME_TYPES),
  hasOutdoorSpace: z.boolean(),
  /** Other animals at home; empty when none. */
  otherAnimals: text(0, ANSWER_MAX_LENGTH),
  /** Their experience with animals. */
  experience: text(0, ANSWER_MAX_LENGTH),
  /** Why this animal, and how it would fit their life. */
  whyThisAnimal: text(10, ANSWER_MAX_LENGTH),
});

export type AdoptionAnswers = z.infer<typeof adoptionAnswersSchema>;

/** An Indian mobile number, kept in E.164 form. */
export const adopterPhoneSchema = z.string().transform((raw, ctx) => {
  const parsed = parsePhoneNumber(raw);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.reason });
    return z.NEVER;
  }
  return parsed.e164 as string;
});

export const adopterAddressSchema = text(10, ADDRESS_MAX_LENGTH);
