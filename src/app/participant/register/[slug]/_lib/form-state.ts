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

/** A field the form can mark: a text field or the consent boxes. */
export type FormField = TextField | "consents";

export type RegisterFormValues = Record<TextField, string> & {
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
    consents: [],
  },
  errors: [],
  refusal: null,
  unexpected: false,
};

/** What the form sent, every field as a string. */
export function valuesFrom(formData: FormData): RegisterFormValues {
  const text = (field: TextField) => {
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
    consents: formData
      .getAll("consents")
      .filter((value): value is string => typeof value === "string"),
  };
}

const FORM_ORDER: readonly FormField[] = [...TEXT_FIELDS, "consents"];

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
  const base = {
    attempt: previous.attempt + 1,
    values,
    errors: [] as FormField[],
    refusal: null,
    unexpected: false,
  };
  if (result === "unexpected") return { ...base, unexpected: true };
  if (result.error === "invalid_input") {
    const fields = new Set(result.fields);
    const errors = FORM_ORDER.filter((field) => fields.has(field));
    // Only the competition's slug is wrong: nothing on the form to fix.
    if (errors.length === 0) return { ...base, refusal: "not_found" };
    return { ...base, errors };
  }
  const { field } = refusalView(result.error);
  return { ...base, refusal: result.error, errors: field ? [field] : [] };
}
