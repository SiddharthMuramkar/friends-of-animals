// What the sign-up and sign-in form shows after each step, from the use
// cases' results. Pure, so the mapping is tested without a page.

import type {
  RequestEmailCodeResult,
  VerifyEmailCodeResult,
} from "@/server/identity";

export type FormAlert =
  | "rate_limited"
  | "code_expired"
  | "too_many_attempts"
  | "no_account"
  | "failed";

export type FormField = "email" | "name" | "code";

export type EmailCodeFormState = {
  step: "email" | "code";
  email: string;
  name: string;
  /**
   * Sign-up only: the messages consent document whose box was ticked, so
   * the code step can send it on. Absent when the box wasn't ticked.
   */
  messagesConsent?: string;
  /** A code was just sent to `email`. */
  sent?: boolean;
  /** A problem for the whole form. */
  alert?: FormAlert;
  retryAfterMinutes?: number;
  /** Fields to mark invalid; each has its own message. */
  fieldErrors?: Partial<Record<FormField, true>>;
};

export const START: EmailCodeFormState = { step: "email", email: "", name: "" };

/** The state plus its words, translated by the action on the server. */
export type EmailCodeFormView = EmailCodeFormState & {
  text: {
    alert?: string;
    sent?: string;
    codeHint?: string;
    errors: Partial<Record<FormField, string>>;
  };
};

export const START_VIEW: EmailCodeFormView = { ...START, text: { errors: {} } };

type Entered = { email: string; name: string; messagesConsent?: string };

function fieldErrors(fields: string[]): EmailCodeFormState["fieldErrors"] {
  const known: FormField[] = ["email", "name", "code"];
  return Object.fromEntries(
    known
      .filter((field) => fields.includes(field))
      .map((field) => [field, true])
  );
}

type Step = EmailCodeFormState["step"];

/**
 * After asking for a code, from the email step or ("Send a new code") from
 * the code step. A refused new code keeps the code step: the last code
 * still works. Fields to fix always go back to the email step, where they
 * show.
 */
export function afterRequest(
  result: RequestEmailCodeResult,
  entered: Entered,
  from: Step = "email"
): EmailCodeFormState {
  if (result.ok) return { step: "code", ...entered, sent: true };
  if (result.error === "invalid_input") {
    return {
      step: "email",
      ...entered,
      fieldErrors: fieldErrors(result.fields),
    };
  }
  return {
    step: from,
    ...entered,
    alert: "rate_limited",
    retryAfterMinutes: Math.ceil(result.retryAfterSeconds / 60),
  };
}

/** When a use case fails outright: stay where the form was, and say so. */
export function afterFailure(from: Step, entered: Entered): EmailCodeFormState {
  return { step: from, ...entered, alert: "failed" };
}

/** For a failed verification; success redirects instead. */
export function afterVerify(
  result: Exclude<VerifyEmailCodeResult, { ok: true }>,
  previous: EmailCodeFormState
): EmailCodeFormState {
  const { email, name, messagesConsent } = previous;
  const entered = {
    email,
    name,
    ...(messagesConsent ? { messagesConsent } : {}),
  };
  switch (result.error) {
    case "invalid_input":
      return {
        step: "code",
        ...entered,
        fieldErrors: fieldErrors(result.fields),
      };
    case "code_invalid":
      return { step: "code", ...entered, fieldErrors: { code: true } };
    default:
      return { step: "code", ...entered, alert: result.error };
  }
}
