// The registration form's state between submissions: what was typed (the
// form resets after an action, so the inputs read it back), which fields
// the use case refused, and an alert for the whole form. Pure, so it
// loads in the client form and the Server Action alike.

import type { RegisterInstitutionResult } from "@/server/institutions";

export const REGISTRATION_FIELDS = [
  "name",
  "type",
  "address",
  "pinCode",
  "city",
  "state",
  "country",
  "contactEmail",
  "contactPhone",
  "principalName",
  "principalEmail",
  "principalPhone",
  "expectedParticipants",
] as const;

export type RegistrationField = (typeof REGISTRATION_FIELDS)[number];

export type RegistrationValues = Record<RegistrationField, string>;

export type RegistrationAlert =
  | "invalid_input"
  | "already_registered"
  | "unexpected";

export type RegistrationFormState = {
  /** Counts submissions, so the form remounts with the values below. */
  attempt: number;
  values: RegistrationValues;
  errors: RegistrationField[];
  alert?: RegistrationAlert;
};

export const START: RegistrationFormState = {
  attempt: 0,
  values: {
    ...(Object.fromEntries(
      REGISTRATION_FIELDS.map((field) => [field, ""])
    ) as RegistrationValues),
    type: "school",
    country: "India",
  },
  errors: [],
};

function isField(name: string): name is RegistrationField {
  return (REGISTRATION_FIELDS as readonly string[]).includes(name);
}

/** The form's fields as text; anything else the browser sends is ignored. */
export function valuesFrom(formData: FormData): RegistrationValues {
  const values = { ...START.values };
  for (const field of REGISTRATION_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

/** The state after a submission that didn't register. */
export function afterResult(
  previous: RegistrationFormState,
  values: RegistrationValues,
  result: Exclude<RegisterInstitutionResult, { ok: true }> | "unexpected"
): RegistrationFormState {
  const attempt = previous.attempt + 1;
  if (result === "unexpected") {
    return { attempt, values, errors: [], alert: "unexpected" };
  }
  if (result.error === "invalid_input") {
    return {
      attempt,
      values,
      errors: result.fields.filter(isField),
      alert: "invalid_input",
    };
  }
  return { attempt, values, errors: [], alert: result.error };
}
