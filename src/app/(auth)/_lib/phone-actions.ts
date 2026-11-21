"use server";

import { formatPhoneNumber, parsePhoneNumber } from "@/lib/phone";
import { as } from "@/server/app";

import { runCodeForm, type CodeFormChannel } from "./code-form-action";
import type { CodeFormView } from "./code-form-state";

const PHONE: CodeFormChannel = {
  channel: "phone",
  messages: "authPhone.form",
  label: "Phone code form",
  request: (actor, { intent, contact: phone, name }) =>
    as(actor).requestPhoneCode(
      intent === "sign-up" ? { intent, phone, name } : { intent, phone }
    ),
  verify: (actor, { intent, contact: phone, name }, code) =>
    as(actor).verifyPhoneCode(
      intent === "sign-up"
        ? { intent, phone, name, code }
        : { intent, phone, code }
    ),
  // The number as people read it, when it is one we can text.
  shown: (phone) => {
    const parsed = parsePhoneNumber(phone);
    return parsed.ok ? formatPhoneNumber(parsed.e164) : phone;
  },
};

/**
 * The phone sign-up and sign-in form's one action: text a code, check the
 * code, or start again (./code-form-action.ts).
 */
export async function phoneCodeAction(
  _previous: CodeFormView,
  formData: FormData
): Promise<CodeFormView> {
  return runCodeForm(PHONE, formData);
}
