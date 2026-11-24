// What someone types into the register or edit form, read into a listing's
// stored form (#127). A bad field comes back by name through
// `invalidInput`, like every other form.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { parsePhoneNumber, type E164Phone } from "../../../../lib/phone";
import {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
  PUBLIC_CONTACT_FIELDS,
  type DirectoryService,
  type ListingType,
  type PublicContactField,
} from "./catalogue";

export const LISTING_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  descriptionMax: 2000,
  addressMax: 300,
  placeMax: 80,
  emailMax: 254,
  websiteMax: 200,
} as const;

/** An Indian PIN code: six digits, not starting with 0. */
export const PIN_CODE_PATTERN = /^[1-9][0-9]{5}$/;

/** Trimmed, with every run of whitespace (newlines too) made one space. */
const singleLine = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(min).max(max));

const multiLine = (max: number) => z.string().trim().min(1).max(max);

/** Nothing typed, or nothing sent, reads as null. */
function optional<T>(schema: z.ZodType<T, string>) {
  return z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      return trimmed === "" ? null : trimmed;
    })
    .pipe(z.union([z.null(), schema]));
}

/** A list from checkboxes: one value, several, or none; catalogue order. */
const someOf = <T extends string>(allowed: readonly [T, ...T[]]) =>
  z
    .union([z.enum(allowed), z.array(z.enum(allowed))])
    .optional()
    .transform((raw): T[] => {
      const chosen = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      return allowed.filter((item) => chosen.includes(item));
    });

/**
 * An Indian mobile number, typed any usual way, read as E.164: people
 * reach a rescuer by phone, and FOA by text once SMS opens (#58).
 */
const mobile = z.string().transform((typed, context): E164Phone => {
  const parsed = parsePhoneNumber(typed);
  if (parsed.ok) return parsed.e164;
  context.addIssue({ code: "custom", message: parsed.reason });
  return z.NEVER;
});

/** An http(s) address with a dotted host; https:// is added if missing. */
const website = z.string().transform((typed, context) => {
  let url: URL;
  try {
    url = new URL(typed.includes("://") ? typed : `https://${typed}`);
  } catch {
    context.addIssue({ code: "custom", message: "invalid" });
    return z.NEVER;
  }
  const allowed =
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.hostname.includes(".") &&
    url.username === "" &&
    url.password === "" &&
    url.toString().length <= LISTING_LIMITS.websiteMax;
  if (!allowed) {
    context.addIssue({ code: "custom", message: "invalid" });
    return z.NEVER;
  }
  return url.toString();
});

export const listingDetailsSchema = z
  .object({
    type: z.enum(LISTING_TYPES),
    name: singleLine(LISTING_LIMITS.nameMin, LISTING_LIMITS.nameMax),
    /** Plain text, newlines kept. Rich text waits for #111's sanitiser. */
    description: multiLine(LISTING_LIMITS.descriptionMax),
    services: someOf(DIRECTORY_SERVICES).pipe(
      z.array(z.enum(DIRECTORY_SERVICES)).min(1)
    ),
    address: multiLine(LISTING_LIMITS.addressMax),
    city: singleLine(1, LISTING_LIMITS.placeMax),
    state: singleLine(1, LISTING_LIMITS.placeMax),
    pinCode: z
      .string()
      .transform((value) => value.replace(/\s/g, ""))
      .pipe(z.string().regex(PIN_CODE_PATTERN)),
    contactPhone: mobile,
    contactEmail: optional(
      z.string().toLowerCase().pipe(z.email().max(LISTING_LIMITS.emailMax))
    ),
    website: optional(website),
    publicContactFields: someOf(PUBLIC_CONTACT_FIELDS),
  })
  // A contact chosen for the public page must exist.
  .superRefine((listing, context) => {
    const missing =
      (listing.publicContactFields.includes("email") &&
        listing.contactEmail === null) ||
      (listing.publicContactFields.includes("website") &&
        listing.website === null);
    if (missing) {
      context.addIssue({
        code: "custom",
        message: "chosen_contact_missing",
        path: ["publicContactFields"],
      });
    }
  });

/** As the form sends it: text, and lists of checkbox values. */
export type ListingDetailsInput = {
  type: string;
  name: string;
  description: string;
  services?: string | readonly string[];
  address: string;
  city: string;
  state: string;
  pinCode: string;
  contactPhone: string;
  contactEmail?: string;
  website?: string;
  publicContactFields?: string | readonly string[];
};

/** A listing's own information, as stored (decrypted) and edited. */
export type ListingDetails = {
  type: ListingType;
  name: string;
  description: string;
  /** At least one, in catalogue order. */
  services: DirectoryService[];
  /** Stored encrypted; never public. */
  address: string;
  city: string;
  state: string;
  pinCode: string;
  /** E.164; stored encrypted. */
  contactPhone: string;
  /** Lower-cased; stored encrypted. */
  contactEmail: string | null;
  website: string | null;
  /** In catalogue order. */
  publicContactFields: PublicContactField[];
};

export type ListingField = keyof ListingDetails;

/** The form's fields, in form order. */
export const LISTING_FIELDS = [
  "type",
  "name",
  "description",
  "services",
  "address",
  "city",
  "state",
  "pinCode",
  "contactPhone",
  "contactEmail",
  "website",
  "publicContactFields",
] as const satisfies readonly ListingField[];
