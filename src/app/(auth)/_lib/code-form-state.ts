// What the sign-up and sign-in forms show after each step, from the use
// cases' results, for codes by email and by SMS alike. Pure, so the
// mapping is tested without a page. A form asks for the contact (an email
// address or a phone number, and a name to sign up), then for the code.
// Phones have two outcomes of their own, a number from another country
// and SMS switched off; both point to email.

import type {
  RequestEmailCodeResult,
  RequestPhoneCodeResult,
  VerifyEmailCodeResult,
  VerifyPhoneCodeResult,
} from "@/server/identity";

/** How the code travels; the use cases name the contact field after it. */
export type CodeChannel = "email" | "phone";

export type CodeFormAlert =
  | "rate_limited"
  | "code_expired"
  | "too_many_attempts"
  | "no_account"
  | "unsupported_country"
  | "sms_disabled"
  | "failed";

export type CodeFormField = "contact" | "name" | "code";

export type CodeFormState = {
  step: "contact" | "code";
  /** The email address or phone number, as typed. */
  contact: string;
  name: string;
  /**
   * Sign-up only: the messages consent document whose box was ticked, so
   * the code step can send it on. Absent when the box wasn't ticked.
   */
  messagesConsent?: string;
  /** A code was just sent to `contact`. */
  sent?: boolean;
  /** A problem for the whole form. */
  alert?: CodeFormAlert;
  retryAfterMinutes?: number;
  /** Fields to mark invalid; each has its own message. */
  fieldErrors?: Partial<Record<CodeFormField, true>>;
};

export const START: CodeFormState = { step: "contact", contact: "", name: "" };

/** The state plus its words, translated by the action on the server. */
export type CodeFormView = CodeFormState & {
  text: {
    alert?: string;
    sent?: string;
    codeHint?: string;
    errors: Partial<Record<CodeFormField, string>>;
  };
};

export const START_VIEW: CodeFormView = { ...START, text: { errors: {} } };

type Entered = { contact: string; name: string; messagesConsent?: string };
type Step = CodeFormState["step"];

function fieldErrors(
  channel: CodeChannel,
  fields: string[]
): CodeFormState["fieldErrors"] {
  const names: Record<CodeFormField, string> = {
    contact: channel,
    name: "name",
    code: "code",
  };
  return Object.fromEntries(
    (Object.keys(names) as CodeFormField[])
      .filter((field) => fields.includes(names[field]))
      .map((field) => [field, true])
  );
}

/**
 * After asking for a code, from the first step or ("Send a new code") from
 * the code step. A refused new code keeps the code step: the last code
 * still works. Fields to fix, a number from another country and SMS
 * switched off go back to the first step.
 */
export function afterRequest(
  channel: CodeChannel,
  result: RequestEmailCodeResult | RequestPhoneCodeResult,
  entered: Entered,
  from: Step = "contact"
): CodeFormState {
  if (result.ok) return { step: "code", ...entered, sent: true };
  switch (result.error) {
    case "invalid_input":
      return {
        step: "contact",
        ...entered,
        fieldErrors: fieldErrors(channel, result.fields),
      };
    case "rate_limited":
      return {
        step: from,
        ...entered,
        alert: "rate_limited",
        retryAfterMinutes: Math.ceil(result.retryAfterSeconds / 60),
      };
    default:
      return { step: "contact", ...entered, alert: result.error };
  }
}

/** When a use case fails outright: stay where the form was, and say so. */
export function afterFailure(from: Step, entered: Entered): CodeFormState {
  return { step: from, ...entered, alert: "failed" };
}

/** For a failed verification; success redirects instead. */
export function afterVerify(
  channel: CodeChannel,
  result: Exclude<VerifyEmailCodeResult | VerifyPhoneCodeResult, { ok: true }>,
  previous: CodeFormState
): CodeFormState {
  const { contact, name, messagesConsent } = previous;
  const entered = {
    contact,
    name,
    ...(messagesConsent ? { messagesConsent } : {}),
  };
  switch (result.error) {
    case "invalid_input":
      return {
        step: "code",
        ...entered,
        fieldErrors: fieldErrors(channel, result.fields),
      };
    case "code_invalid":
      return { step: "code", ...entered, fieldErrors: { code: true } };
    case "sms_disabled":
      return { step: "contact", ...entered, alert: "sms_disabled" };
    default:
      return { step: "code", ...entered, alert: result.error };
  }
}

/**
 * How long a rate-limited visitor waits, as the alert says it: in minutes,
 * or in hours when the day's limit means a long wait. Unknown means one
 * 15-minute window.
 */
export function waitFor(
  minutes: number | undefined
): { minutes: number } | { hours: number } {
  const wait = minutes ?? 15;
  return wait > 60 ? { hours: Math.ceil(wait / 60) } : { minutes: wait };
}
