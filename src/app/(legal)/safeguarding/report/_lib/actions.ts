"use server";

import { getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";

import {
  afterFailure,
  afterSubmit,
  concernInput,
  enteredFrom,
  type ConcernFormField,
  type ConcernFormState,
  type ConcernFormView,
} from "./form-state";

/**
 * A human-check challenge as the island receives it. Its lifetime is a
 * length from when it arrives, so the island never compares its clock with
 * the server's.
 */
export type ChallengeView = {
  token: string;
  salt: string;
  difficulty: number;
  /** After this long, the server refuses the proof. */
  expiresInMs: number;
};

/** A challenge for the form island to solve while the reporter types. */
export async function issueConcernChallengeAction(): Promise<ChallengeView> {
  const actor = await currentActor();
  const challenge = await as(actor).issueHumanCheckChallenge();
  return {
    token: challenge.token,
    salt: challenge.salt,
    difficulty: challenge.difficulty,
    expiresInMs: challenge.expiresAt.getTime() - challenge.issuedAt.getTime(),
  };
}

async function withText(state: ConcernFormState): Promise<ConcernFormView> {
  const t = await getTranslations("safeguardingReport");
  const errors: Partial<Record<ConcernFormField, string>> = {};
  for (const field of Object.keys(state.fieldErrors ?? {})) {
    const key = field as ConcernFormField;
    errors[key] = t(`form.${key}.error`);
  }
  const alert =
    state.alert === "rate_limited"
      ? t("alerts.rate_limited", { minutes: state.retryAfterMinutes ?? 60 })
      : state.alert
        ? t(`alerts.${state.alert}`)
        : undefined;
  return { ...state, text: { alert, errors } };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The form's action: one report, with the island's proof. A sent report
 * goes to the confirmation page, which shows nothing of it; anything else
 * comes back to the form with what was typed.
 */
export async function submitConcernAction(
  _previous: ConcernFormView,
  formData: FormData
): Promise<ConcernFormView> {
  const entered = enteredFrom(formData);
  const token = field(formData, "humanCheckToken");
  const nonce = Number.parseInt(field(formData, "humanCheckNonce"), 10);
  let state: ConcernFormState;
  try {
    const actor = await currentActor();
    const result = await as(actor).submitSafeguardingReport({
      ...concernInput(entered),
      website: field(formData, "website"),
      humanCheck: token
        ? { token, nonce: Number.isNaN(nonce) ? -1 : nonce }
        : undefined,
    });
    state = afterSubmit(result, entered);
  } catch (error) {
    // Only the error's class and Postgres code: its message can hold what
    // the reporter wrote.
    console.error(
      `Safeguarding report: the use case failed: ${errorSummaryForLogs(error)}`
    );
    state = afterFailure(entered);
  }
  // redirect() throws, so it stays out of the try above.
  if (state.step === "sent") {
    redirect(ROUTES.safeguardingReportSent.path, RedirectType.replace);
  }
  return withText(state);
}
