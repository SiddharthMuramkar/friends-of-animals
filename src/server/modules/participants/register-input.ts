// What the individual register form sends, read into the details the
// register use case works with. Field rules only: whether the person may
// register at all (the competition's window, their age, consents still
// missing) is the eligibility decision's to say, with a reason.
//
// Pure: loads under plain Node.

import { z } from "zod";

import { parsePhoneNumber } from "../../../lib/phone";
import type { GuardianDetailsInput } from "../guardians/guardian-request";

/** The same pattern the competition pages and the proxy accept. */
export const COMPETITION_SLUG_PATTERN = /^[a-z0-9-]{3,80}$/;

/** Indian PIN codes are six digits, and none starts with 0. */
const INDIAN_PIN_CODE = /^[1-9]\d{5}$/;

/** A postal code elsewhere: letters and digits, maybe a space or hyphen. */
const POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;

const regionNames = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
});

/** Codes the region names know that are not a country someone lives in. */
const NOT_COUNTRIES = new Set(["EU", "EZ", "QO", "UN", "XA", "XB", "ZZ"]);

/** An ISO 3166-1 alpha-2 code the platform knows a country name for. */
function isCountryCode(code: string): boolean {
  return (
    /^[A-Z]{2}$/.test(code) &&
    !NOT_COUNTRIES.has(code) &&
    regionNames.of(code) !== undefined
  );
}

/** Every country the form offers, India first, then by English name. */
export function countryOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      if (isCountryCode(code)) {
        options.push({ value: code, label: regionNames.of(code) ?? code });
      }
    }
  }
  const byName = new Intl.Collator("en-IN");
  return options.toSorted((a, b) =>
    a.value === "IN"
      ? -1
      : b.value === "IN"
        ? 1
        : byName.compare(a.label, b.label)
  );
}

/** A PIN code as stored: Indian ones without the space people put in. */
function storedPinCode(country: string, pinCode: string): string {
  return country === "IN" ? pinCode.replace(/ /g, "") : pinCode;
}

function isPinCode(country: string, pinCode: string): boolean {
  return (country === "IN" ? INDIAN_PIN_CODE : POSTAL_CODE).test(
    storedPinCode(country, pinCode)
  );
}

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const fields = z.object({
  competitionSlug: z.string().trim().regex(COMPETITION_SLUG_PATTERN),
  /** Whitespace runs inside the name become one space. */
  fullName: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(2).max(100)),
  /** As typed; the eligibility decision reads it (`dob_invalid`). */
  dateOfBirth: text(1, 32),
  /** Read into E.164 with the phone sign-in rules (#58): Indian mobiles. */
  phone: text(1, 32),
  /** Checked against the country below. */
  pinCode: z.string().trim(),
  city: text(2, 80),
  state: text(2, 60),
  country: z.string().trim().toUpperCase().refine(isCountryCode),
  schoolName: z
    .string()
    .trim()
    .max(150)
    .optional()
    .transform((value) => value || null),
  /** Ids of the document versions ticked, each once. */
  consents: z
    .array(z.uuid())
    .default([])
    .transform((ids) => [...new Set(ids)]),
});

const registerInput = fields
  // Runs beside the field checks, so the form hears of every field at
  // fault at once.
  .superRefine((form, ctx) => {
    if (!parsePhoneNumber(form.phone).ok) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Not an Indian mobile number",
      });
    }
    if (!isPinCode(form.country, form.pinCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["pinCode"],
        message: "Not a PIN or postal code for this country",
      });
    }
  })
  .transform((form) => {
    const phone = parsePhoneNumber(form.phone);
    return {
      ...form,
      phone: phone.ok ? phone.e164 : form.phone,
      pinCode: storedPinCode(form.country, form.pinCode),
    };
  });

/** What the form sends for the person's own details: every field as typed. */
export type RegisterFormInput = z.input<typeof registerInput>;

/**
 * What the register form sends (#78, #81). A guardian registering their
 * child names the child's profile and sends no name or date of birth: the
 * profile's are used, as for a teen whose login is linked. A teen with no
 * guardian on the platform names one.
 */
export type RegisterAsIndividualInput = Omit<
  RegisterFormInput,
  "fullName" | "dateOfBirth"
> &
  Partial<Pick<RegisterFormInput, "fullName" | "dateOfBirth">> & {
    /** A child the signed-in guardian looks after. */
    forChildId?: string;
    /** The parent or guardian a teen asks, as typed. */
    guardian?: GuardianDetailsInput;
  };

/** The form's details, trimmed and checked. */
export type RegisterInput = z.output<typeof registerInput>;

type Field = keyof RegisterFormInput;

/** The form's fields in the order a person fills them in. */
const FIELD_ORDER = Object.keys(fields.shape) as Field[];

export type RegisterInputResult =
  | { ok: true; value: RegisterInput }
  /** `fields` names each field at fault, in the form's order. */
  | { ok: false; fields: Field[] };

export function parseRegisterInput(input: unknown): RegisterInputResult {
  const parsed = registerInput.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const atFault = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return {
    ok: false,
    fields: FIELD_ORDER.filter((field) => atFault.has(field)),
  };
}
