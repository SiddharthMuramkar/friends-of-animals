// Reads what someone typed into the register or edit form into a listing's
// stored form, with one error code per bad field so the form can show them
// all at once. The phone parser comes in from the caller (#58 owns it), so
// this file stays pure.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
  PUBLIC_CONTACT_FIELDS,
  type DirectoryService,
  type ListingType,
  type PublicContactField,
} from "./catalogue";

/** A listing's own information, as stored and edited. */
export type ListingDetails = {
  type: ListingType;
  name: string;
  /** Plain text; newlines kept. Rich text waits for #111's sanitiser. */
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
  contactEmail: string | null;
  website: string | null;
  /** In catalogue order. */
  publicContactFields: PublicContactField[];
};

export type ListingField = keyof ListingDetails;

export type ListingFieldError =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid"
  | "chosen_contact_missing";

export type ListingInputResult =
  | { ok: true; value: ListingDetails }
  | { ok: false; errors: Partial<Record<ListingField, ListingFieldError>> };

export const LISTING_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  descriptionMax: 2000,
  addressMax: 300,
  placeMax: 80,
  emailMax: 254,
  websiteMax: 200,
} as const;

const PIN_CODE = /^[1-9]\d{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field<T> =
  | { ok: true; value: T }
  | { ok: false; error: ListingFieldError };

const fail = (error: ListingFieldError): Field<never> => ({ ok: false, error });

function text(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** Trimmed, with every run of whitespace (newlines too) made one space. */
function singleLine(raw: unknown): string {
  return text(raw).replace(/\s+/g, " ");
}

function bounded(
  value: string,
  limits: { min?: number; max: number }
): Field<string> {
  if (value === "") return fail("required");
  if (value.length < (limits.min ?? 1)) return fail("too_short");
  if (value.length > limits.max) return fail("too_long");
  return { ok: true, value };
}

function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[]
): Field<T> {
  if (raw === undefined || raw === null || raw === "") return fail("required");
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? { ok: true, value: raw as T }
    : fail("invalid");
}

/** A list from checkboxes: a string, an array of strings, or nothing. */
function someOf<T extends string>(
  raw: unknown,
  allowed: readonly T[]
): Field<T[]> {
  const items =
    raw === undefined || raw === null
      ? []
      : typeof raw === "string"
        ? [raw]
        : raw;
  if (!Array.isArray(items)) return fail("invalid");
  if (!items.every((item) => (allowed as readonly unknown[]).includes(item))) {
    return fail("invalid");
  }
  return { ok: true, value: allowed.filter((item) => items.includes(item)) };
}

function pinCode(raw: unknown): Field<string> {
  const value = text(raw).replace(/\s/g, "");
  if (value === "") return fail("required");
  return PIN_CODE.test(value) ? { ok: true, value } : fail("invalid");
}

function phone(
  raw: unknown,
  normalisePhone: (raw: string) => string | null
): Field<string> {
  const value = text(raw);
  if (value === "") return fail("required");
  const normalised = normalisePhone(value);
  return normalised === null
    ? fail("invalid")
    : { ok: true, value: normalised };
}

function email(raw: unknown): Field<string | null> {
  const value = text(raw).toLowerCase();
  if (value === "") return { ok: true, value: null };
  if (value.length > LISTING_LIMITS.emailMax || !EMAIL.test(value)) {
    return fail("invalid");
  }
  return { ok: true, value };
}

/** An http(s) address with a dotted host; https:// is added if missing. */
function website(raw: unknown): Field<string | null> {
  const value = text(raw);
  if (value === "") return { ok: true, value: null };
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return fail("invalid");
  }
  const allowed =
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.hostname.includes(".") &&
    url.username === "" &&
    url.password === "";
  if (!allowed) return fail("invalid");
  const normalised = url.toString();
  return normalised.length > LISTING_LIMITS.websiteMax
    ? fail("too_long")
    : { ok: true, value: normalised };
}

export function parseListingInput(
  raw: unknown,
  deps: { normalisePhone: (raw: string) => string | null }
): ListingInputResult {
  const input: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? { ...raw } : {};
  const fields = {
    type: oneOf(input.type, LISTING_TYPES),
    name: bounded(singleLine(input.name), {
      min: LISTING_LIMITS.nameMin,
      max: LISTING_LIMITS.nameMax,
    }),
    description: bounded(text(input.description), {
      max: LISTING_LIMITS.descriptionMax,
    }),
    services: ((): Field<DirectoryService[]> => {
      const services = someOf(input.services, DIRECTORY_SERVICES);
      return services.ok && services.value.length === 0
        ? fail("required")
        : services;
    })(),
    address: bounded(text(input.address), { max: LISTING_LIMITS.addressMax }),
    city: bounded(singleLine(input.city), { max: LISTING_LIMITS.placeMax }),
    state: bounded(singleLine(input.state), { max: LISTING_LIMITS.placeMax }),
    pinCode: pinCode(input.pinCode),
    contactPhone: phone(input.contactPhone, deps.normalisePhone),
    contactEmail: email(input.contactEmail),
    website: website(input.website),
    publicContactFields: someOf(
      input.publicContactFields,
      PUBLIC_CONTACT_FIELDS
    ),
  };

  // A contact chosen for the public page must exist. Checked only when the
  // contact itself was read, so a bad email is reported once, on the email.
  const chosen = fields.publicContactFields;
  if (chosen.ok) {
    const missing =
      (chosen.value.includes("email") &&
        fields.contactEmail.ok &&
        fields.contactEmail.value === null) ||
      (chosen.value.includes("website") &&
        fields.website.ok &&
        fields.website.value === null);
    if (missing) fields.publicContactFields = fail("chosen_contact_missing");
  }

  const errors: Partial<Record<ListingField, ListingFieldError>> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (!field.ok) errors[name as ListingField] = field.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const value = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      field.ok ? field.value : null,
    ])
  ) as ListingDetails;
  return { ok: true, value };
}
