"use server";

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { formatPhoneNumber, parsePhoneNumber } from "@/lib/phone";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { EMAIL_CODE } from "@/server/identity/settings";

import {
  afterPhoneFailure,
  afterPhoneRequest,
  afterPhoneVerify,
  PHONE_START,
  type PhoneCodeFormState,
  type PhoneCodeFormView,
  type PhoneFormField,
} from "./phone-form-state";

/** The number as people read it, when it is one we can text. */
function shown(phone: string): string {
  const parsed = parsePhoneNumber(phone);
  return parsed.ok ? formatPhoneNumber(parsed.e164) : phone;
}

async function withText(state: PhoneCodeFormState): Promise<PhoneCodeFormView> {
  const t = await getTranslations("authPhone.form");
  const errors: Partial<Record<PhoneFormField, string>> = {};
  if (state.fieldErrors?.phone) errors.phone = t("phone.error");
  if (state.fieldErrors?.name) errors.name = t("name.error");
  if (state.fieldErrors?.code) errors.code = t("code.error");
  let alert: string | undefined;
  if (state.alert === "rate_limited") {
    const minutes = state.retryAfterMinutes ?? 15;
    // The daily limit can mean hours of waiting.
    alert =
      minutes > 60
        ? t("alerts.rate_limited_hours", { hours: Math.ceil(minutes / 60) })
        : t("alerts.rate_limited", { minutes });
  } else if (state.alert) {
    alert = t(`alerts.${state.alert}`);
  }
  const phone = shown(state.phone);
  return {
    ...state,
    text: {
      alert,
      sent: state.sent ? t("sent", { phone }) : undefined,
      codeHint:
        state.step === "code"
          ? t("code.hint", { phone, minutes: EMAIL_CODE.lifetimeMinutes })
          : undefined,
      errors,
    },
  };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The phone sign-up and sign-in form's one action. `step` (from the
 * pressed button) says what to do: text a code, check the code, or start
 * again.
 */
export async function phoneCodeAction(
  _previous: PhoneCodeFormView,
  formData: FormData
): Promise<PhoneCodeFormView> {
  const intent =
    field(formData, "intent") === "sign-up" ? "sign-up" : "sign-in";
  const step = field(formData, "step") || "phone";
  // The step the form was showing; "Send a new code" asks for a code
  // (step "phone") from the code step.
  const from = field(formData, "from") === "code" ? "code" : "phone";
  const entered = {
    phone: field(formData, "phone"),
    name: field(formData, "name"),
  };

  const actor = await currentActor();
  if (actor.kind !== "visitor") redirect(APP_ROUTES.accountSessions);
  if (step === "restart") {
    return withText({ ...PHONE_START, name: entered.name });
  }

  try {
    if (step === "code") {
      const code = field(formData, "code");
      const result = await as(actor).verifyPhoneCode(
        intent === "sign-up"
          ? { intent, ...entered, code }
          : { intent, phone: entered.phone, code }
      );
      if (!result.ok) {
        return withText(afterPhoneVerify(result, { step: "code", ...entered }));
      }
    } else {
      return withText(
        afterPhoneRequest(
          await as(actor).requestPhoneCode(
            intent === "sign-up"
              ? { intent, ...entered }
              : { intent, phone: entered.phone }
          ),
          entered,
          from
        )
      );
    }
  } catch (error) {
    // Only the error's class and Postgres code: its message can hold the
    // number or the code.
    console.error(
      `Phone code form: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return withText(
      afterPhoneFailure(step === "code" ? "code" : from, entered)
    );
  }
  // Signed in: the session cookie is set. Outside the try, because
  // redirect() works by throwing.
  redirect(APP_ROUTES.accountSessions);
}
