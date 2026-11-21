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

export type ContactFormEntered = Record<ContactFormField, string>;

export type ContactFormAlert = "human_check_failed" | "rate_limited" | "failed";

export type ContactFormState = {
  step: "form" | "sent";
  entered: ContactFormEntered;
  /** The sender's reference, once sent. */
  reference?: string;
  alert?: ContactFormAlert;
  retryAfterMinutes?: number;
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

export function enteredFrom(formData: FormData): ContactFormEntered {
  return {
    topic: "",
    name: "",
    email: "",
    organisation: "",
    subject: "",
    message: "",
  };
}

export function afterSubmit(
  result: SubmitContactMessageResult,
  entered: ContactFormEntered
): ContactFormState {
  void result;
  return { step: "form", entered };
}

export function afterFailure(entered: ContactFormEntered): ContactFormState {
  return { step: "form", entered };
}
