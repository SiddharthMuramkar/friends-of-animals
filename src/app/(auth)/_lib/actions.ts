"use server";

import { as } from "@/server/app";

import { runCodeForm, type CodeFormChannel } from "./code-form-action";
import type { CodeFormView } from "./code-form-state";

const EMAIL: CodeFormChannel = {
  channel: "email",
  messages: "auth.form",
  label: "Email code form",
  request: (actor, { intent, contact: email, name }) =>
    as(actor).requestEmailCode(
      intent === "sign-up" ? { intent, email, name } : { intent, email }
    ),
  verify: (actor, { intent, contact: email, name }, code) =>
    as(actor).verifyEmailCode(
      intent === "sign-up"
        ? { intent, email, name, code }
        : { intent, email, code }
    ),
  shown: (email) => email,
};

/**
 * The email sign-up and sign-in form's one action: email a code, check
 * the code, or start again (./code-form-action.ts).
 */
export async function emailCodeAction(
  _previous: CodeFormView,
  formData: FormData
): Promise<CodeFormView> {
  return runCodeForm(EMAIL, formData);
}
