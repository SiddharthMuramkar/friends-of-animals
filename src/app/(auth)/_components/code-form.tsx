"use client";

import { useActionState, type ReactNode } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import { inlineLink } from "@/components/site/link-styles";
import { SiteLink } from "@/components/site/site-link";

import {
  START_VIEW,
  type CodeChannel,
  type CodeFormView,
} from "../_lib/code-form-state";

export type CodeFormLabels = {
  name: { label: string; hint: string };
  /** The email address or mobile number field. */
  contact: { label: string; hint: string };
  code: { label: string };
  sendCode: string;
  sending: string;
  verify: string;
  checking: string;
  resend: string;
  changeContact: string;
  signUpInstead: string;
  /** By phone: the way to email, for numbers we can't text. */
  useEmail?: string | undefined;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  done: string;
};

/** The contact field's input, by channel. */
const CONTACT_INPUT = {
  email: { type: "email", autoComplete: "email", maxLength: 254 },
  phone: { type: "tel", autoComplete: "tel", maxLength: 20 },
} as const;

/**
 * Sign up or sign in by a code, in two steps on one form: the email
 * address or mobile number (and, to sign up, a name), then the code we
 * send. Every message comes translated from `action`; static words come
 * in `labels`. To sign up, `consentField` (the optional messages consent
 * box, from the server) shows on the first step, and the code step sends
 * on what was ticked.
 */
export function CodeForm({
  action,
  channel,
  intent,
  labels,
  signUpPath,
  emailPath,
  consentField,
}: {
  action: (previous: CodeFormView, formData: FormData) => Promise<CodeFormView>;
  channel: CodeChannel;
  intent: "sign-up" | "sign-in";
  labels: CodeFormLabels;
  /** Where "Create an account instead" goes. */
  signUpPath: string;
  /** By phone: the email form for this intent, for numbers we can't text. */
  emailPath?: string;
  /** Sign-up's optional messages consent box (#64). */
  consentField?: ReactNode;
}) {
  const [view, formAction] = useActionState(action, START_VIEW);
  const { text } = view;
  const toEmail =
    emailPath && labels.useEmail
      ? { href: emailPath, text: labels.useEmail }
      : undefined;
  const pointsToEmail =
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
              <SiteLink href={signUpPath} className={inlineLink}>
                {labels.signUpInstead}
              </SiteLink>
            </p>
          ) : pointsToEmail && toEmail ? (
            <p>
              <SiteLink href={toEmail.href} className={inlineLink}>
                {toEmail.text}
              </SiteLink>
            </p>
          ) : null}
        </FormAlert>
      ) : text.sent ? (
        <FormAlert tone="success" label={labels.done}>
          <p>{text.sent}</p>
        </FormAlert>
      ) : null}

      {view.step === "contact" ? (
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
            id={channel}
            name={channel}
            {...CONTACT_INPUT[channel]}
            spellCheck={false}
            required
            defaultValue={view.contact}
            label={labels.contact.label}
            hint={labels.contact.hint}
            error={text.errors.contact}
          />
          {intent === "sign-up" ? consentField : null}
          <div>
            <SubmitButton
              name="step"
              value="contact"
              pendingLabel={labels.sending}
            >
              {labels.sendCode}
            </SubmitButton>
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name={channel} value={view.contact} />
          <input type="hidden" name="name" value={view.name} />
          {view.messagesConsent ? (
            <input
              type="hidden"
              name="messagesConsent"
              value={view.messagesConsent}
            />
          ) : null}
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
              value="contact"
              variant="secondary"
              pendingLabel={labels.sending}
            >
              {labels.resend}
            </SubmitButton>
            <SubmitButton
              name="step"
              value="restart"
              variant="quiet"
              pendingLabel={labels.changeContact}
            >
              {labels.changeContact}
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
