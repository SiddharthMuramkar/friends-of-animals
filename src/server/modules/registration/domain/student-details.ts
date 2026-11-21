// The details a coordinator gives for one student (#75), checked and
// cleaned in one place. The single-student form uses it, and so does the
// CSV import (#76), so a row and a form are held to the same rules and
// report the same per-field error codes.
//
// Whether the student is a minor decides who the contact is: a minor's
// guardian (name, relationship and phone required), or an adult student
// themselves (phone required). Details that don't belong to that case are
// dropped and listed in `ignored`, so nothing is kept that isn't needed.
//
// Pure: the caller passes today's date in India and #58's phone
// normaliser. Loads under plain Node.

import {
  type CalendarDate,
  compareDates,
  completedYearsOn,
  isRealDate,
  parseIsoDate,
} from "./calendar-date";

/** From this age a student is their own contact. */
export const ADULT_AGE = 18;

/** Dates of birth before this are taken as typing mistakes. */
const EARLIEST_BIRTH: CalendarDate = { year: 1900, month: 1, day: 1 };

export const GUARDIAN_RELATIONSHIPS = ["parent", "legal_guardian"] as const;

export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

/** Raw values, as a form or a CSV row gives them. */
export type StudentInput = {
  fullName?: string | undefined;
  /** `YYYY-MM-DD`, or day first with slashes: `DD/MM/YYYY`. */
  dateOfBirth?: string | undefined;
  /** Class or year, for example "Class 5". */
  grade?: string | undefined;
  /** The institution's own roll number for the student. */
  studentRef?: string | undefined;
  address?: string | undefined;
  pinCode?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  /** An adult student's own phone and email. */
  phone?: string | undefined;
  email?: string | undefined;
  /** A minor's guardian. */
  guardianName?: string | undefined;
  guardianRelationship?: string | undefined;
  guardianPhone?: string | undefined;
  guardianEmail?: string | undefined;
};

export type StudentField = keyof StudentInput;

export type StudentFieldError =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_date"
  | "in_future"
  | "too_early"
  | "invalid_format"
  | "invalid_choice"
  | "invalid_phone"
  | "invalid_email";

export type StudentContact =
  | {
      kind: "guardian";
      name: string;
      relationship: GuardianRelationship;
      /** E.164. */
      phone: string;
      email: string | null;
    }
  | { kind: "self"; phone: string; email: string | null };

export type StudentDetails = {
  fullName: string;
  dateOfBirth: CalendarDate;
  /** Under ADULT_AGE on today's date in India. */
  isMinor: boolean;
  grade: string | null;
  studentRef: string | null;
  address: string | null;
  pinCode: string | null;
  city: string | null;
  state: string | null;
  contact: StudentContact;
};

export type StudentDetailsResult =
  | { ok: true; value: StudentDetails; ignored: StudentField[] }
  | { ok: false; errors: Partial<Record<StudentField, StudentFieldError>> };

export type StudentDetailsContext = {
  /** Today's date in India (`indianDateAt(clock.now())`). */
  today: CalendarDate;
  /** #58's normaliser: E.164, or null when it isn't a phone number. */
  normalisePhone: (raw: string) => string | null;
};

const GUARDIAN_FIELDS = [
  "guardianName",
  "guardianRelationship",
  "guardianPhone",
  "guardianEmail",
] as const satisfies readonly StudentField[];

const SELF_FIELDS = [
  "phone",
  "email",
] as const satisfies readonly StudentField[];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_CODE = /^[1-9]\d{5}$/;
const DAY_FIRST = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Characters as a reader counts them: "रा" or an emoji is one. */
function characterCount(text: string): number {
  return Array.from(graphemes.segment(text)).length;
}

export function parseStudentDetails(
  input: StudentInput,
  { today, normalisePhone }: StudentDetailsContext
): StudentDetailsResult {
  const errors: Partial<Record<StudentField, StudentFieldError>> = {};
  const fail = (field: StudentField, error: StudentFieldError): null => {
    errors[field] = error;
    return null;
  };
  const value = (field: StudentField): string =>
    (input[field] ?? "").replace(/\s+/g, " ").trim();

  const name = (field: StudentField, required: boolean): string | null => {
    const text = value(field);
    if (!text) return required ? fail(field, "required") : null;
    const length = characterCount(text);
    if (length < 2) return fail(field, "too_short");
    if (length > 100) return fail(field, "too_long");
    return text;
  };

  const optional = (field: StudentField, max: number): string | null => {
    const text = value(field);
    if (!text) return null;
    return characterCount(text) > max ? fail(field, "too_long") : text;
  };

  const phone = (field: StudentField, required: boolean): string | null => {
    const text = value(field);
    if (!text) return required ? fail(field, "required") : null;
    return normalisePhone(text) ?? fail(field, "invalid_phone");
  };

  const email = (field: StudentField): string | null => {
    const text = value(field).toLowerCase();
    if (!text) return null;
    return text.length <= 254 && EMAIL.test(text)
      ? text
      : fail(field, "invalid_email");
  };

  const relationship = (required: boolean): GuardianRelationship | null => {
    const text = value("guardianRelationship")
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (!text)
      return required ? fail("guardianRelationship", "required") : null;
    const known = GUARDIAN_RELATIONSHIPS.find((choice) => choice === text);
    return known ?? fail("guardianRelationship", "invalid_choice");
  };

  const dateOfBirth = (): CalendarDate | null => {
    const text = value("dateOfBirth");
    if (!text) return fail("dateOfBirth", "required");
    const date = parseIsoDate(text) ?? parseDayFirst(text);
    if (!date) return fail("dateOfBirth", "invalid_date");
    if (compareDates(date, today) > 0) return fail("dateOfBirth", "in_future");
    if (compareDates(date, EARLIEST_BIRTH) < 0) {
      return fail("dateOfBirth", "too_early");
    }
    return date;
  };

  const pinCode = (): string | null => {
    const text = value("pinCode").replace(/\s/g, "");
    if (!text) return null;
    return PIN_CODE.test(text) ? text : fail("pinCode", "invalid_format");
  };

  const fullName = name("fullName", true);
  const birth = dateOfBirth();
  const details = {
    grade: optional("grade", 20),
    studentRef: optional("studentRef", 40),
    address: optional("address", 300),
    pinCode: pinCode(),
    city: optional("city", 60),
    state: optional("state", 60),
  };

  const isMinor =
    birth === null ? null : completedYearsOn(birth, today) < ADULT_AGE;
  const present = (fields: readonly StudentField[]) =>
    fields.filter((field) => value(field) !== "");
  const ignored: StudentField[] =
    isMinor === true
      ? present(SELF_FIELDS)
      : isMinor === false
        ? present(GUARDIAN_FIELDS)
        : [];

  // With no usable date of birth, nothing is required yet, but whatever
  // was given is still checked, so every mistake shows at once.
  const guardian =
    isMinor !== false
      ? {
          name: name("guardianName", isMinor === true),
          relationship: relationship(isMinor === true),
          phone: phone("guardianPhone", isMinor === true),
          email: email("guardianEmail"),
        }
      : null;
  const self =
    isMinor !== true
      ? {
          phone: phone("phone", isMinor === false),
          email: email("email"),
        }
      : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (fullName === null || birth === null || isMinor === null) {
    throw new Error("parseStudentDetails: a required field slipped through");
  }

  let contact: StudentContact;
  if (isMinor) {
    if (!guardian?.name || !guardian.relationship || !guardian.phone) {
      throw new Error("parseStudentDetails: guardian contact slipped through");
    }
    contact = {
      kind: "guardian",
      name: guardian.name,
      relationship: guardian.relationship,
      phone: guardian.phone,
      email: guardian.email,
    };
  } else {
    if (!self?.phone) {
      throw new Error("parseStudentDetails: own phone slipped through");
    }
    contact = { kind: "self", phone: self.phone, email: self.email };
  }

  return {
    ok: true,
    ignored,
    value: { fullName, dateOfBirth: birth, isMinor, ...details, contact },
  };
}

/** `DD/MM/YYYY`: dates with slashes are always day first. */
function parseDayFirst(text: string): CalendarDate | null {
  const match = DAY_FIRST.exec(text);
  if (!match) return null;
  const date = {
    year: Number(match[3]),
    month: Number(match[2]),
    day: Number(match[1]),
  };
  return isRealDate(date) ? date : null;
}
