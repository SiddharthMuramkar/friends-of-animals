// What the phone sign-up and sign-in form shows after each step, from the
// use cases' results. Pure, so the mapping is tested without a page. The
// email form's twin (./form-state.ts), with the phone's own outcomes: a
// number from another country, and SMS switched off, both point to email.

import type {
  RequestPhoneCodeResult,
  VerifyPhoneCodeResult,
} from "@/server/identity";

export type PhoneFormAlert =
  | "rate_limited"
  | "code_expired"
  | "too_many_attempts"
  | "no_account"
  | "unsupported_country"
  | "sms_disabled"
  | "failed";

export type PhoneFormField = "phone" | "name" | "code";

export type PhoneCodeFormState = {
  step: "phone" | "code";
  /** The number as typed. */
  phone: string;
  name: string;
  /** A code was just texted to `phone`. */
  sent?: boolean;
  /** A problem for the whole form. */
  alert?: PhoneFormAlert;
  retryAfterMinutes?: number;
  /** Fields to mark invalid; each has its own message. */
  fieldErrors?: Partial<Record<PhoneFormField, true>>;
};

export const PHONE_START: PhoneCodeFormState = {
  step: "phone",
  phone: "",
  name: "",
};

/** The state plus its words, translated by the action on the server. */
export type PhoneCodeFormView = PhoneCodeFormState & {
  text: {
    alert?: string;
    sent?: string;
    codeHint?: string;
    errors: Partial<Record<PhoneFormField, string>>;
  };
};

export const PHONE_START_VIEW: PhoneCodeFormView = {
  ...PHONE_START,
  text: { errors: {} },
};

type Entered = { phone: string; name: string };
type Step = PhoneCodeFormState["step"];

function fieldErrors(fields: string[]): PhoneCodeFormState["fieldErrors"] {
  const known: PhoneFormField[] = ["phone", "name", "code"];
  return Object.fromEntries(
    known
      .filter((field) => fields.includes(field))
      .map((field) => [field, true])
  );
}

/**
 * After asking for a code, from the phone step or ("Send a new code") from
 * the code step. A refused new code keeps the code step: the last code
 * still works. Fields to fix, a number from another country and SMS
 * switched off go back to the phone step.
 */
export function afterPhoneRequest(
  result: RequestPhoneCodeResult,
  entered: Entered,
  from: Step = "phone"
): PhoneCodeFormState {
  if (result.ok) return { step: "code", ...entered, sent: true };
  switch (result.error) {
    case "invalid_input":
      return {
        step: "phone",
        ...entered,
        fieldErrors: fieldErrors(result.fields),
      };
    case "rate_limited":
      return {
        step: from,
        ...entered,
        alert: "rate_limited",
        retryAfterMinutes: Math.ceil(result.retryAfterSeconds / 60),
      };
    default:
      return { step: "phone", ...entered, alert: result.error };
  }
}

/** When a use case fails outright: stay where the form was, and say so. */
export function afterPhoneFailure(
  from: Step,
  entered: Entered
): PhoneCodeFormState {
  return { step: from, ...entered, alert: "failed" };
}

/** For a failed verification; success redirects instead. */
export function afterPhoneVerify(
  result: Exclude<VerifyPhoneCodeResult, { ok: true }>,
  previous: PhoneCodeFormState
): PhoneCodeFormState {
  const entered = { phone: previous.phone, name: previous.name };
  switch (result.error) {
    case "invalid_input":
      return {
        step: "code",
        ...entered,
        fieldErrors: fieldErrors(result.fields),
      };
    case "code_invalid":
      return { step: "code", ...entered, fieldErrors: { code: true } };
    case "sms_disabled":
      return { step: "phone", ...entered, alert: "sms_disabled" };
    default:
      return { step: "code", ...entered, alert: result.error };
  }
}
