import { createTranslator } from "next-intl";

import authPhone from "../../../messages/en-IN/authPhone.json";
import type { E164Phone } from "../../lib/phone";
import type { SmsMessage } from "../ports/sms";

/**
 * The text that carries a sign-in code, worded from messages/en-IN. Its
 * DLT template (HR-14) must match this wording, with ##code## and
 * ##minutes## for the variables.
 */
export function codeSms(
  to: E164Phone,
  code: string,
  minutes: number
): SmsMessage {
  const t = createTranslator({
    locale: "en-IN",
    messages: authPhone,
    namespace: "authPhone.sms.code",
  });
  return {
    to,
    template: "sign-in-code",
    vars: { code, minutes: String(minutes) },
    text: t("text", { code, minutes }),
  };
}
