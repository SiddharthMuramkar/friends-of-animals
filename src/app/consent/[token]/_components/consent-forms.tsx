"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import { documentVersionPath } from "@/server/modules/competitions/domain/consent-attachments";
import type { OfferedPublicUse } from "@/server/modules/consent-links/offered-uses";

import {
  saveAnswersAction,
  sendCodeAction,
  verifyCodeAction,
} from "../actions";

type Failure = Awaited<
  ReturnType<
    typeof sendCodeAction | typeof verifyCodeAction | typeof saveAnswersAction
  >
>;

function ActionError({ state }: { state: Failure | null }) {
  const t = useTranslations("guardianConsent.errors");
  const callout = useTranslations("common.callout");
  const format = useFormatter();
  if (!state) return null;
  const values = {
    ...("attemptsLeft" in state ? { attemptsLeft: state.attemptsLeft } : {}),
    ...("retryAt" in state && state.retryAt
      ? { retryTime: format.dateTime(state.retryAt, "longDateTime") }
      : {}),
  };
  return (
    <FormAlert tone="danger" label={callout("danger")}>
      {t(state.error, values)}
    </FormAlert>
  );
}

export function SendCodeForm({
  token,
  resend,
}: {
  token: string;
  resend: boolean;
}) {
  const t = useTranslations("guardianConsent");
  const [state, action] = useActionState(
    sendCodeAction.bind(null, token),
    null
  );
  const label = t(resend ? "resendCode" : "sendCode");
  return (
    <form
      action={action}
      aria-label={label}
      className="flex flex-col items-start gap-3"
    >
      <ActionError state={state} />
      <SubmitButton
        variant={resend ? "secondary" : "primary"}
        pendingLabel={t("sending")}
      >
        {label}
      </SubmitButton>
    </form>
  );
}

export function VerifyCodeForm({
  token,
  contact,
}: {
  token: string;
  contact: string;
}) {
  const t = useTranslations("guardianConsent");
  const [state, action] = useActionState(
    verifyCodeAction.bind(null, token),
    null
  );
  return (
    <form
      action={action}
      aria-label={t("verify")}
      className="flex flex-col items-start gap-4"
    >
      <ActionError state={state} />
      <TextField
        id="consent-code"
        name="code"
        label={t("code")}
        hint={t("codeHint", { contact })}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        pattern="[0-9]{6}"
        maxLength={6}
        required
      />
      <SubmitButton pendingLabel={t("verifying")}>{t("verify")}</SubmitButton>
    </form>
  );
}

export function AnswersForm({
  token,
  uses,
}: {
  token: string;
  uses: readonly OfferedPublicUse[];
}) {
  const t = useTranslations("guardianConsent");
  const [state, action] = useActionState(
    saveAnswersAction.bind(null, token),
    null
  );
  return (
    <form
      action={action}
      aria-label={t("answer")}
      className="flex flex-col items-start gap-5"
    >
      <ActionError state={state} />
      {uses.map(({ purpose, title, version }) => (
        <fieldset
          key={purpose}
          className="w-full rounded-2xl border-2 border-border px-4 py-3"
        >
          <legend className="px-1 font-bold text-ink">
            {t(`uses.${purpose}`)}
          </legend>
          <a
            href={documentVersionPath(purpose, version)}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-link underline wrap-anywhere"
          >
            {t("viewDocument", { title, version })}
          </a>
          <div className="mt-2 flex flex-wrap gap-x-5">
            {(["give", "decline"] as const).map((answer) => (
              <label
                key={answer}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink"
              >
                <input
                  type="radio"
                  name={`answer:${purpose}`}
                  value={answer}
                  required
                />
                {t(`choices.${answer}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <SubmitButton pendingLabel={t("saving")}>{t("answer")}</SubmitButton>
    </form>
  );
}
