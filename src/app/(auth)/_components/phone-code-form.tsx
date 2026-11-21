"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import { SiteLink } from "@/components/site/site-link";

import {
  PHONE_START_VIEW,
  type PhoneCodeFormView,
} from "../_lib/phone-form-state";

export type PhoneCodeFormLabels = {
  name: { label: string; hint: string };
  phone: { label: string; hint: string };
  code: { label: string };
  sendCode: string;
  sending: string;
  verify: string;
  checking: string;
  resend: string;
  changePhone: string;
  signUpInstead: string;
  useEmail: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  done: string;
};

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * Sign up or sign in by SMS code, in two steps on one form: the mobile
 * number (and, to sign up, a name), then the code we text. Every message
 * comes translated from `action`; static words come in `labels`.
 */
export function PhoneCodeForm({
  action,
  intent,
  labels,
  signUpPath,
  emailPath,
}: {
  action: (
    previous: PhoneCodeFormView,
    formData: FormData
  ) => Promise<PhoneCodeFormView>;
  intent: "sign-up" | "sign-in";
  labels: PhoneCodeFormLabels;
  /** Where "Create an account instead" goes. */
  signUpPath: string;
  /** The email form for this intent, for numbers we can't text. */
  emailPath: string;
}) {
  const [view, formAction] = useActionState(action, PHONE_START_VIEW);
  const { text } = view;
  const toEmail =
    view.alert === "unsupported_country" || view.alert === "sms_disabled";

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="from" value={view.step} />

      {text.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{text.alert}</p>
          {view.alert === "no_account" ? (
            <p>
              <SiteLink href={signUpPath} className={LINK}>
                {labels.signUpInstead}
              </SiteLink>
            </p>
          ) : toEmail ? (
            <p>
              <SiteLink href={emailPath} className={LINK}>
                {labels.useEmail}
              </SiteLink>
            </p>
          ) : null}
        </FormAlert>
      ) : text.sent ? (
        <FormAlert tone="success" label={labels.done}>
          <p>{text.sent}</p>
        </FormAlert>
      ) : null}

      {view.step === "phone" ? (
        <>
          {intent === "sign-up" ? (
            <TextField
              id="name"
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              defaultValue={view.name}
              label={labels.name.label}
              hint={labels.name.hint}
              error={text.errors.name}
            />
          ) : null}
          <TextField
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            spellCheck={false}
            required
            maxLength={20}
            defaultValue={view.phone}
            label={labels.phone.label}
            hint={labels.phone.hint}
            error={text.errors.phone}
          />
          <div>
            <SubmitButton
              name="step"
              value="phone"
              pendingLabel={labels.sending}
            >
              {labels.sendCode}
            </SubmitButton>
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="phone" value={view.phone} />
          <input type="hidden" name="name" value={view.name} />
          <TextField
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            label={labels.code.label}
            hint={text.codeHint}
            error={
              text.errors.code ?? (view.name ? undefined : text.errors.name)
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton
              name="step"
              value="code"
              pendingLabel={labels.checking}
            >
              {labels.verify}
            </SubmitButton>
            <SubmitButton
              name="step"
              value="phone"
              variant="secondary"
              pendingLabel={labels.sending}
            >
              {labels.resend}
            </SubmitButton>
            <SubmitButton
              name="step"
              value="restart"
              variant="quiet"
              pendingLabel={labels.changePhone}
            >
              {labels.changePhone}
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
