// The individual register form's state between submissions (#78): what was
// typed, which fields to fix, and a refusal to show. Pure, so the action's
// mapping from a use-case result to what the form shows is tested on its
// own.

import type { RegisterAsIndividualResult } from "@/server/modules/participants";

import { refusalView, type Refusal } from "./refusal";

/** The form's text fields, in the order a person fills them in. */
export const TEXT_FIELDS = [
  "fullName",
  "dateOfBirth",
  "phone",
  "pinCode",
  "city",
  "state",
  "country",
  "schoolName",
] as const;

export type TextField = (typeof TEXT_FIELDS)[number];

/** A teen's parent or guardian (#81), asked for when they are needed. */
export const GUARDIAN_FIELDS = [
  "guardianName",
  "guardianRelationship",
  "guardianEmail",
] as const;

export type GuardianField = (typeof GUARDIAN_FIELDS)[number];

/** A field the form can mark: a text field, the consent boxes or a guardian's. */
export type FormField = TextField | "consents" | GuardianField;

export type RegisterFormValues = Record<TextField | GuardianField, string> & {
  consents: string[];
};

export type RegisterFormState = {
  /** Bumped on every submission, so the inputs remount with `values`. */
  attempt: number;
  values: RegisterFormValues;
  /** Fields to fix, in form order. */
  errors: FormField[];
  refusal: Refusal | null;
  unexpected: boolean;
  /** Show the parent or guardian fields: a teen on their own needs them. */
  askGuardian: boolean;
  /**
   * Registered: the page to go on to (the pay page, or the dashboard for a
   * registration held for a guardian), which the browser loads in full. The
   * pay page's CSP (Razorpay's origins) and headers come only with its own
   * document, which a server action's redirect, a client-side navigation,
   * would not fetch.
   */
  destination: string | null;
};

export const START: RegisterFormState = {
  attempt: 0,
  values: {
    fullName: "",
    dateOfBirth: "",
    phone: "",
    pinCode: "",
    city: "",
    state: "",
    country: "IN",
    schoolName: "",
    guardianName: "",
    guardianRelationship: "",
    guardianEmail: "",
    consents: [],
  },
  errors: [],
  refusal: null,
  unexpected: false,
  askGuardian: false,
  destination: null,
};

/** What the form sent, every field as a string. */
export function valuesFrom(formData: FormData): RegisterFormValues {
  const text = (field: TextField | GuardianField) => {
    const value = formData.get(field);
    return typeof value === "string" ? value : "";
  };
  return {
    fullName: text("fullName"),
    dateOfBirth: text("dateOfBirth"),
    phone: text("phone"),
    pinCode: text("pinCode"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    schoolName: text("schoolName"),
    guardianName: text("guardianName"),
    guardianRelationship: text("guardianRelationship"),
    guardianEmail: text("guardianEmail"),
    consents: formData
      .getAll("consents")
      .filter((value): value is string => typeof value === "string"),
  };
}

const FORM_ORDER: readonly FormField[] = [
  ...TEXT_FIELDS,
  ...GUARDIAN_FIELDS,
  "consents",
];

/** Refusals that ask a teen on their own for their guardian. */
const GUARDIAN_REFUSALS: readonly Refusal[] = [
  "guardian_details_required",
  "guardian_contact_is_self",
];

/**
 * The form after a refused submission: the fields at fault, or the
 * refusal with the field it points at; an unexpected failure keeps what
 * was typed.
 */
export function afterResult(
  previous: RegisterFormState,
  values: RegisterFormValues,
  result: Exclude<RegisterAsIndividualResult, { ok: true }> | "unexpected"
): RegisterFormState {
  const base = next(previous, values);
  if (result === "unexpected") return { ...base, unexpected: true };
  if (result.error === "invalid_input") {
    const fields = new Set(result.fields);
    const errors = FORM_ORDER.filter((field) => fields.has(field));
    // Only the competition's slug is wrong: nothing on the form to fix.
    if (errors.length === 0) return { ...base, refusal: "not_found" };
    return { ...base, errors };
  }
  const { field } = refusalView(result.error);
  return {
    ...base,
    refusal: result.error,
    errors: field ? [field] : [],
    askGuardian: base.askGuardian || GUARDIAN_REFUSALS.includes(result.error),
  };
}

/**
 * The form once registered: on to `destination`, such as the pay page or,
 * for a registration held for a guardian, the dashboard.
 */
export function registered(
  previous: RegisterFormState,
  values: RegisterFormValues,
  destination: string
): RegisterFormState {
  return { ...next(previous, values), destination };
}

/** A submission's state before what came of it. */
function next(
  previous: RegisterFormState,
  values: RegisterFormValues
): RegisterFormState {
  return {
    attempt: previous.attempt + 1,
    values,
    errors: [],
    refusal: null,
    unexpected: false,
    askGuardian: previous.askGuardian,
    destination: null,
  };
}
