// What the contact form shows after each submission, from the use case's
// result. Pure, so the mapping is tested without a page.

import type { SubmitContactMessageResult } from "@/server/modules/contact";

export type ContactFormField =
  | "topic"
  | "name"
  | "email"
  | "organisation"
  | "subject"
  | "message";

const FIELDS: readonly ContactFormField[] = [
  "topic",
  "name",
  "email",
  "organisation",
  "subject",
  "message",
];

export type ContactFormEntered = Record<ContactFormField, string>;

export type ContactFormAlert = "human_check_failed" | "rate_limited" | "failed";

export type ContactFormState = {
  /** "sent" shows the reference in place of the form. */
  step: "form" | "sent";
  /** What the form shows in its fields. */
  entered: ContactFormEntered;
  reference?: string;
  /** A problem for the whole form. */
  alert?: ContactFormAlert;
  retryAfterMinutes?: number;
  /** Fields to mark invalid; each has its own message. */
  fieldErrors?: Partial<Record<ContactFormField, true>>;
};

export const EMPTY: ContactFormEntered = {
  topic: "",
  name: "",
  email: "",
  organisation: "",
  subject: "",
  message: "",
};

export const START: ContactFormState = { step: "form", entered: EMPTY };

/** The fields as typed; a missing field or a file reads as blank. */
export function enteredFrom(formData: FormData): ContactFormEntered {
  const entered = { ...EMPTY };
  for (const field of FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") entered[field] = value;
  }
  return entered;
}

export function afterSubmit(
  result: SubmitContactMessageResult,
  entered: ContactFormEntered
): ContactFormState {
  if (result.ok) {
    return { step: "sent", reference: result.reference, entered: EMPTY };
  }
  switch (result.error) {
    case "invalid_input":
      return {
        step: "form",
        entered,
        fieldErrors: Object.fromEntries(
          FIELDS.filter((field) => result.fields.includes(field)).map(
            (field) => [field, true]
          )
        ),
      };
    case "rate_limited":
      return {
        step: "form",
        entered,
        alert: "rate_limited",
        retryAfterMinutes: Math.ceil(result.retryAfterSeconds / 60),
      };
    default:
      return { step: "form", entered, alert: result.error };
  }
}

/**
 * Whether the human-check proof sent with the submission behind `state` is
 * still unspent, so the island sends it again. The use case checks the
 * fields before it redeems a proof, and a refused send rolls the
 * redemption back. Reusing it keeps the bot screen's clock running from
 * when the visitor started, so fixing a field and sending at once isn't
 * taken for a bot. A sent message spent it; a failed check refused it;
 * an outright failure may have spent it.
 */
export function keepsProof(state: ContactFormState): boolean {
  if (state.step === "sent") return false;
  return state.alert === undefined || state.alert === "rate_limited";
}

/** When the use case fails outright: keep what was typed, and say so. */
export function afterFailure(entered: ContactFormEntered): ContactFormState {
  return { step: "form", entered, alert: "failed" };
}

/** The state plus its words, translated by the action on the server. */
export type ContactFormView = ContactFormState & {
  text: {
    alert?: string;
    sent?: string;
    errors: Partial<Record<ContactFormField, string>>;
  };
};

export const START_VIEW: ContactFormView = { ...START, text: { errors: {} } };
