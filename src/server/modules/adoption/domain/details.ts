// What a representative enters about an animal (#129). The dashboard
// form's Server Action hands the fields over as typed; this schema checks
// each one and normalises its text. Problems are reported as codes
// (`required`, `too_long`, ...) on the field's path, for the form to show
// next to it.
//
// Every text field is plain text, never HTML: React escapes it when it
// renders, and paragraphs come from line breaks. That keeps the rich-text
// sanitiser (#111) out of this module.
//
// Pure: no I/O, no "server-only", no `@/` imports.

import { z } from "zod";

import { AGE_LIMITS } from "./age";

export const ADOPTION_SPECIES = [
  "dog",
  "cat",
  "rabbit",
  "bird",
  "other",
] as const;
export type AdoptionSpecies = (typeof ADOPTION_SPECIES)[number];

export const ANIMAL_SEXES = ["female", "male", "unknown"] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

export const ANIMAL_SIZES = ["small", "medium", "large"] as const;
export type AnimalSize = (typeof ANIMAL_SIZES)[number];

/** Lengths in graphemes (characters as people see them). */
export const ADOPTION_TEXT_LIMITS = {
  nameMax: 60,
  breedMax: 60,
  colourMax: 40,
  aboutMax: 1500,
  healthNotesMax: 2000,
  vaccinationNotesMax: 1000,
  conditionsMax: 2000,
  cityMax: 80,
} as const;

/** The states and union territories of India, for location and filters. */
export const INDIAN_STATES = [
  { key: "andhra_pradesh", name: "Andhra Pradesh", kind: "state" },
  { key: "arunachal_pradesh", name: "Arunachal Pradesh", kind: "state" },
  { key: "assam", name: "Assam", kind: "state" },
  { key: "bihar", name: "Bihar", kind: "state" },
  { key: "chhattisgarh", name: "Chhattisgarh", kind: "state" },
  { key: "goa", name: "Goa", kind: "state" },
  { key: "gujarat", name: "Gujarat", kind: "state" },
  { key: "haryana", name: "Haryana", kind: "state" },
  { key: "himachal_pradesh", name: "Himachal Pradesh", kind: "state" },
  { key: "jharkhand", name: "Jharkhand", kind: "state" },
  { key: "karnataka", name: "Karnataka", kind: "state" },
  { key: "kerala", name: "Kerala", kind: "state" },
  { key: "madhya_pradesh", name: "Madhya Pradesh", kind: "state" },
  { key: "maharashtra", name: "Maharashtra", kind: "state" },
  { key: "manipur", name: "Manipur", kind: "state" },
  { key: "meghalaya", name: "Meghalaya", kind: "state" },
  { key: "mizoram", name: "Mizoram", kind: "state" },
  { key: "nagaland", name: "Nagaland", kind: "state" },
  { key: "odisha", name: "Odisha", kind: "state" },
  { key: "punjab", name: "Punjab", kind: "state" },
  { key: "rajasthan", name: "Rajasthan", kind: "state" },
  { key: "sikkim", name: "Sikkim", kind: "state" },
  { key: "tamil_nadu", name: "Tamil Nadu", kind: "state" },
  { key: "telangana", name: "Telangana", kind: "state" },
  { key: "tripura", name: "Tripura", kind: "state" },
  { key: "uttar_pradesh", name: "Uttar Pradesh", kind: "state" },
  { key: "uttarakhand", name: "Uttarakhand", kind: "state" },
  { key: "west_bengal", name: "West Bengal", kind: "state" },
  {
    key: "andaman_and_nicobar_islands",
    name: "Andaman and Nicobar Islands",
    kind: "union_territory",
  },
  { key: "chandigarh", name: "Chandigarh", kind: "union_territory" },
  {
    key: "dadra_nagar_haveli_daman_diu",
    name: "Dadra and Nagar Haveli and Daman and Diu",
    kind: "union_territory",
  },
  { key: "delhi", name: "Delhi", kind: "union_territory" },
  {
    key: "jammu_and_kashmir",
    name: "Jammu and Kashmir",
    kind: "union_territory",
  },
  { key: "ladakh", name: "Ladakh", kind: "union_territory" },
  { key: "lakshadweep", name: "Lakshadweep", kind: "union_territory" },
  { key: "puducherry", name: "Puducherry", kind: "union_territory" },
] as const;

export type IndianState = (typeof INDIAN_STATES)[number]["key"];

const STATE_KEYS = INDIAN_STATES.map((state) => state.key) as [
  IndianState,
  ...IndianState[],
];

/** A state's name, from its key; anything else as it is. */
export function indianStateName(key: string): string {
  return INDIAN_STATES.find((state) => state.key === key)?.name ?? key;
}

export function isIndianState(value: string): value is IndianState {
  return (STATE_KEYS as readonly string[]).includes(value);
}

/** India Post PIN codes: six digits, the first not 0. */
export const PIN_CODE_PATTERN = /^[1-9][0-9]{5}$/;

const graphemes = new Intl.Segmenter("en-IN", { granularity: "grapheme" });

export function graphemeLength(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text)) count += 1;
  return count;
}

// C0 and C1 controls except tab and line feed, and the bidirectional
// embeddings, overrides and isolates that can make text read differently
// from how it is stored. Zero-width joiners stay: emoji need them.
const STRIPPED =
  // oxlint-disable-next-line no-control-regex -- stripping them is the point
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/**
 * Text as stored: composed (NFC), without control characters, runs of
 * spaces collapsed and trimmed. A one-line field joins its lines; a
 * multi-line field keeps line breaks, with at most one blank line between
 * paragraphs.
 */
export function normalisePlainText(text: string, multiline: boolean): string {
  const lines = text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(STRIPPED, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim());
  if (!multiline) return lines.filter(Boolean).join(" ");
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function text(max: number, multiline: boolean) {
  return z
    .string()
    .transform((value) => normalisePlainText(value, multiline))
    .refine((value) => value.length > 0, { message: "required" })
    .refine((value) => graphemeLength(value) <= max, { message: "too_long" });
}

/** Blank or missing means "not given" and is stored as null. */
function optionalText(max: number, multiline: boolean) {
  return z
    .string()
    .nullable()
    .optional()
    .transform((value) =>
      value == null ? "" : normalisePlainText(value, multiline)
    )
    .refine((value) => graphemeLength(value) <= max, { message: "too_long" })
    .transform((value) => (value === "" ? null : value));
}

const L = ADOPTION_TEXT_LIMITS;

export const adoptionListingDetailsSchema = z.object({
  name: text(L.nameMax, false),
  species: z.enum(ADOPTION_SPECIES, { message: "invalid" }),
  breed: optionalText(L.breedMax, false),
  sex: z.enum(ANIMAL_SEXES, { message: "invalid" }),
  size: z.enum(ANIMAL_SIZES, { message: "invalid" }).nullable(),
  colour: optionalText(L.colourMax, false),
  /** The estimated age today; the use case turns it into a birth month. */
  age: z.object({
    years: z
      .number({ message: "invalid" })
      .int({ message: "invalid" })
      .min(0, { message: "invalid" })
      .max(AGE_LIMITS.maxYears, { message: "too_old" }),
    months: z
      .number({ message: "invalid" })
      .int({ message: "invalid" })
      .min(0, { message: "invalid" })
      .max(11, { message: "invalid" }),
  }),
  /** null: not known. */
  sterilised: z.boolean().nullable(),
  about: optionalText(L.aboutMax, true),
  healthNotes: optionalText(L.healthNotesMax, true),
  vaccinationNotes: optionalText(L.vaccinationNotesMax, true),
  conditions: text(L.conditionsMax, true),
  state: z.enum(STATE_KEYS, { message: "invalid" }),
  city: text(L.cityMax, false),
  pinCode: z.string().trim().regex(PIN_CODE_PATTERN, { message: "invalid" }),
});

export type AdoptionListingDetailsInput = z.input<
  typeof adoptionListingDetailsSchema
>;
export type AdoptionListingDetails = z.output<
  typeof adoptionListingDetailsSchema
>;
