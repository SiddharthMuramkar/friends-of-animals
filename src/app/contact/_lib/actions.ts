"use server";

import { getTranslations } from "next-intl/server";

import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";

import { challengeView } from "./challenge-view";
import {
  afterFailure,
  afterSubmit,
  enteredFrom,
  type ContactFormField,
  type ContactFormState,
  type ContactFormView,
} from "./form-state";
import type { ChallengeView } from "./proof-keeper";

/** A challenge for the form island to solve while the visitor types. */
export async function issueChallengeAction(): Promise<ChallengeView> {
  const actor = await currentActor();
  return challengeView(await as(actor).issueHumanCheckChallenge());
}

async function withText(state: ContactFormState): Promise<ContactFormView> {
  const t = await getTranslations("contactForm");
  const errors: Partial<Record<ContactFormField, string>> = {};
  for (const field of Object.keys(state.fieldErrors ?? {})) {
    const key = field as ContactFormField;
    errors[key] = t(`${key}.error`);
  }
  let alert: string | undefined;
  if (state.alert === "rate_limited") {
    const minutes = state.retryAfterMinutes ?? 60;
    // The per-address limit is a day's: that can mean hours.
    alert =
      minutes > 60
        ? t("alerts.rate_limited_hours", { hours: Math.ceil(minutes / 60) })
        : t("alerts.rate_limited", { minutes });
  } else if (state.alert) {
    alert = t(`alerts.${state.alert}`);
  }
  return {
    ...state,
    text: {
      alert,
      sent: state.reference
        ? t("sent", { reference: state.reference })
        : undefined,
      errors,
    },
  };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The contact form's action: one message, with the island's proof. */
export async function submitContactAction(
  _previous: ContactFormView,
  formData: FormData
): Promise<ContactFormView> {
  const entered = enteredFrom(formData);
  const token = field(formData, "humanCheckToken");
  const nonce = Number.parseInt(field(formData, "humanCheckNonce"), 10);
  try {
    const actor = await currentActor();
    const result = await as(actor).submitContactMessage({
      ...entered,
      organisation: entered.organisation || undefined,
      website: field(formData, "website"),
      humanCheck: token
        ? { token, nonce: Number.isNaN(nonce) ? -1 : nonce }
        : undefined,
    });
    return withText(afterSubmit(result, entered));
  } catch (error) {
    // Only the error's class and Postgres code: its message can hold what
    // the sender wrote.
    console.error(
      `Contact form: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return withText(afterFailure(entered));
  }
}
