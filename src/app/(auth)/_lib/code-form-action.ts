// The one flow behind the sign-up and sign-in forms, by email or by SMS:
// read the pressed step, send a code or check it, and turn the result into
// what the form shows, in words from the channel's messages namespace
// (both use the same keys and placeholders). Each channel's action, a
// "use server" file beside this one, says which use cases to call.

import "server-only";

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import type { Actor } from "@/server/actor";
import { currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type {
  RequestEmailCodeResult,
  RequestPhoneCodeResult,
  VerifyEmailCodeResult,
  VerifyPhoneCodeResult,
} from "@/server/identity";
import { SIGN_IN_CODE } from "@/server/identity/settings";

import {
  afterFailure,
  afterRequest,
  afterVerify,
  START,
  waitFor,
  type CodeChannel,
  type CodeFormState,
  type CodeFormView,
} from "./code-form-state";

/** What the visitor sent: the contact, and their name to sign up. */
export type Entered = {
  intent: "sign-up" | "sign-in";
  contact: string;
  name: string;
  /**
   * Sign-up only: the messages consent document whose box was ticked
   * (#64). Absent when the box wasn't ticked or isn't on the form.
   */
  messagesConsent?: string;
};

export type CodeFormChannel = {
  /** Also the name of the form's contact field. */
  channel: CodeChannel;
  messages: "auth.form" | "authPhone.form";
  /** Names the form in the server log. */
  label: string;
  request: (
    actor: Actor,
    entered: Entered
  ) => Promise<RequestEmailCodeResult | RequestPhoneCodeResult>;
  verify: (
    actor: Actor,
    entered: Entered,
    code: string
  ) => Promise<VerifyEmailCodeResult | VerifyPhoneCodeResult>;
  /** The contact as the form's messages show it. */
  shown: (contact: string) => string;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The state plus its words, translated here on the server. */
async function withText(
  { channel, messages, shown }: CodeFormChannel,
  state: CodeFormState
): Promise<CodeFormView> {
  const t = await getTranslations(messages);
  const errors: CodeFormView["text"]["errors"] = {};
  if (state.fieldErrors?.contact) errors.contact = t(`${channel}.error`);
  if (state.fieldErrors?.name) errors.name = t("name.error");
  if (state.fieldErrors?.code) errors.code = t("code.error");
  let alert: string | undefined;
  if (state.alert === "rate_limited") {
    const wait = waitFor(state.retryAfterMinutes);
    alert =
      "hours" in wait
        ? t("alerts.rate_limited_hours", wait)
        : t("alerts.rate_limited", wait);
  } else if (state.alert) {
    alert = t(`alerts.${state.alert}`);
  }
  const contact = shown(state.contact);
  return {
    ...state,
    text: {
      alert,
      sent: state.sent ? t("sent", { contact }) : undefined,
      codeHint:
        state.step === "code"
          ? t("code.hint", {
              contact,
              minutes: SIGN_IN_CODE.lifetimeMinutes,
            })
          : undefined,
      errors,
    },
  };
}

/**
 * One step of a code form. `step` (from the pressed button) says what to
 * do: send a code, check the code, or start again. Signed in, the visitor
 * goes to their sessions.
 */
export async function runCodeForm(
  channel: CodeFormChannel,
  formData: FormData
): Promise<CodeFormView> {
  const intent =
    field(formData, "intent") === "sign-up" ? "sign-up" : "sign-in";
  // Sign-up's optional messages consent box: the document id it showed,
  // only when ticked.
  const messagesConsent =
    intent === "sign-up" ? field(formData, "messagesConsent") : "";
  const consent = messagesConsent ? { messagesConsent } : {};
  const entered: Entered = {
    intent,
    contact: field(formData, channel.channel),
    name: field(formData, "name"),
    ...consent,
  };
  const typed = { contact: entered.contact, name: entered.name, ...consent };
  const step = field(formData, "step");
  // The step the form was showing; "Send a new code" asks for a code from
  // the code step.
  const from = field(formData, "from") === "code" ? "code" : "contact";

  const actor = await currentActor();
  if (actor.kind !== "visitor") redirect(APP_ROUTES.accountSessions);
  if (step === "restart") {
    return withText(channel, { ...START, name: entered.name });
  }

  let consentNotRecorded = false;
  try {
    if (step === "code") {
      const code = field(formData, "code");
      const result = await channel.verify(actor, entered, code);
      if (!result.ok) {
        return withText(
          channel,
          afterVerify(channel.channel, result, { step: "code", ...typed })
        );
      }
      // The box was ticked, but staff published a new version meanwhile:
      // the account exists, and the settings page shows the new text.
      const outcome =
        "messagesConsent" in result ? result.messagesConsent : undefined;
      if (outcome && outcome !== "given") consentNotRecorded = true;
    } else {
      const result = await channel.request(actor, entered);
      return withText(
        channel,
        afterRequest(channel.channel, result, typed, from)
      );
    }
  } catch (error) {
    // Only the error's class and Postgres code: its message can hold the
    // address, the number or the code.
    console.error(
      `${channel.label}: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return withText(
      channel,
      afterFailure(step === "code" ? "code" : from, typed)
    );
  }
  // Signed in: the session cookie is set. Outside the try, because
  // redirect() works by throwing.
  redirect(
    consentNotRecorded ? APP_ROUTES.accountConsents : APP_ROUTES.accountSessions
  );
}
