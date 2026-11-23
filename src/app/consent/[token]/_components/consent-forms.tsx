"use client";

import { useActionState, useEffect, useRef } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import type { OfferedPublicUse } from "@/server/modules/consent-links/offered-uses";

import {
  saveAnswersAction,
  sendCodeAction,
  verifyCodeAction,
} from "../actions";

type SubmitLabels = { submit: string; pending: string; danger: string };

function ActionError({
  message,
  label,
}: {
  message: string | undefined;
  label: string;
}) {
  if (!message) return null;
  return (
    <FormAlert tone="danger" label={label}>
      {message}
    </FormAlert>
  );
}

export function SendCodeForm({
  token,
  resend,
  labels,
}: {
  token: string;
  resend: boolean;
  labels: SubmitLabels;
}) {
  const [state, action] = useActionState(
    sendCodeAction.bind(null, token),
    null
  );
  return (
    <form
      action={action}
      aria-label={labels.submit}
      className="flex flex-col items-start gap-3"
    >
      <ActionError message={state?.message} label={labels.danger} />
      <SubmitButton
        variant={resend ? "secondary" : "primary"}
        pendingLabel={labels.pending}
      >
        {labels.submit}
      </SubmitButton>
    </form>
  );
}

export function VerifyCodeForm({
  token,
  labels,
}: {
  token: string;
  labels: SubmitLabels & { code: string; hint: string };
}) {
  const codeField = useRef<HTMLInputElement>(null);
  const [state, action] = useActionState(
    verifyCodeAction.bind(null, token),
    null
  );
  const codeError =
    state?.error === "wrong_code" || state?.error === "invalid_code"
      ? state
      : undefined;
  useEffect(() => {
    if (codeError) codeField.current?.focus();
  }, [codeError]);
  return (
    <form
      action={action}
      aria-label={labels.submit}
      className="flex flex-col items-start gap-4"
    >
      <ActionError message={state?.message} label={labels.danger} />
      <TextField
        ref={codeField}
        id="consent-code"
        name="code"
        label={labels.code}
        hint={labels.hint}
        error={codeError?.message}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        pattern="[0-9]{6}"
        maxLength={6}
        required
      />
      <SubmitButton pendingLabel={labels.pending}>{labels.submit}</SubmitButton>
    </form>
  );
}

type AnswerUse = {
  purpose: OfferedPublicUse["purpose"];
  label: string;
  document: { href: string; label: string };
};

export function AnswersForm({
  token,
  uses,
  labels,
}: {
  token: string;
  uses: readonly AnswerUse[];
  labels: SubmitLabels & { choices: { give: string; decline: string } };
}) {
  const [state, action] = useActionState(
    saveAnswersAction.bind(null, token),
    null
  );
  return (
    <form
      action={action}
      aria-label={labels.submit}
      className="flex flex-col items-start gap-5"
    >
      <ActionError message={state?.message} label={labels.danger} />
      {uses.map(({ purpose, label, document }) => (
        <fieldset
          key={purpose}
          className="w-full rounded-2xl border-2 border-border px-4 py-3"
        >
          <legend className="px-1 font-bold text-ink">{label}</legend>
          <a
            href={document.href}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-link underline wrap-anywhere"
          >
            {document.label}
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
                {labels.choices[answer]}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <SubmitButton pendingLabel={labels.pending}>{labels.submit}</SubmitButton>
    </form>
  );
}
