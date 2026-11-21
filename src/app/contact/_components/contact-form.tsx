"use client";

import { OctagonAlert, ShieldAlert } from "lucide-react";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { SiteLink } from "@/components/site/site-link";
import { solveProofOfWork } from "@/lib/proof-of-work";
import { ROUTES } from "@/lib/routes";

import { issueChallengeAction, submitContactAction } from "../_lib/actions";
import { START_VIEW, type ContactFormView } from "../_lib/form-state";

/** Picking it shows where to go instead; the form never sends it. */
const SAFEGUARDING = "SAFEGUARDING";

export type ContactFormLabels = {
  topic: { legend: string };
  safeguarding: { label: string; body: string; link: string };
  name: { label: string };
  email: { label: string; hint: string };
  organisation: { label: string };
  subject: { label: string };
  message: { label: string; hint: string };
  honeypot: string;
  privacy: string;
  privacyLink: string;
  send: string;
  sending: string;
  sendAnother: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  done: string;
};

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

type Proof = { token: string; nonce: number; expiresAt: number };

/**
 * The contact form island on the prerendered /contact page. When the form
 * first gets focus it fetches a human-check challenge and solves it in the
 * background (src/lib/proof-of-work.ts), so the proof is usually ready by
 * the time the visitor presses Send. Every message comes translated from
 * the action; static words come in `labels`.
 */
export function ContactForm(props: {
  labels: ContactFormLabels;
  topics: readonly { value: string; label: string }[];
}) {
  // A new key starts a blank form after "Send another message".
  const [round, setRound] = useState(0);
  return (
    <ContactFormRound
      key={round}
      {...props}
      onSendAnother={() => setRound((n) => n + 1)}
    />
  );
}

function ContactFormRound({
  labels,
  topics,
  onSendAnother,
}: {
  labels: ContactFormLabels;
  topics: readonly { value: string; label: string }[];
  onSendAnother: () => void;
}) {
  const proof = useRef<Promise<Proof> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /** The proof for the next send, started once and reused until spent. */
  function humanCheck(): Promise<Proof> {
    const current = proof.current;
    if (current) return current;
    const next = (async () => {
      const challenge = await issueChallengeAction();
      const nonce = await solveProofOfWork(challenge);
      return {
        token: challenge.token,
        nonce,
        expiresAt: Date.parse(challenge.expiresAt),
      };
    })();
    proof.current = next;
    // A failed fetch is tried again on the next focus or send.
    next.catch(() => {
      if (proof.current === next) proof.current = null;
    });
    return next;
  }

  async function send(previous: ContactFormView, formData: FormData) {
    try {
      let ready = await humanCheck();
      if (ready.expiresAt <= Date.now()) {
        proof.current = null;
        ready = await humanCheck();
      }
      formData.set("humanCheckToken", ready.token);
      formData.set("humanCheckNonce", String(ready.nonce));
    } catch {
      // Sent without a proof, the server answers "human check failed",
      // which asks the visitor to press Send again.
    }
    // Each proof works once: the next send solves a new one.
    proof.current = null;
    return submitContactAction(previous, formData);
  }

  const [view, formAction, sending] = useActionState(send, START_VIEW);

  // Sent from the submit event, not a form `action`: React prerenders a
  // client action as a javascript: URL, which the CSP blocks
  // (scripts/csp-output.ts). The form status only follows `action`, so
  // the button gets the action's own pending state.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  // Start solving when the visitor first reaches the form, not on every
  // page view: most visitors never write.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const start = () => void humanCheck().catch(() => undefined);
    form.addEventListener("focusin", start, { once: true });
    return () => form.removeEventListener("focusin", start);
  });
  const { text } = view;
  const [topic, setTopic] = useState(view.entered.topic);

  if (view.step === "sent") {
    return (
      <div className="flex flex-col items-start gap-4">
        <FormAlert tone="success" label={labels.done} className="w-full">
          <p>{text.sent}</p>
        </FormAlert>
        <button
          type="button"
          onClick={onSendAnother}
          className={buttonStyles({ variant: "secondary" })}
        >
          {labels.sendAnother}
        </button>
      </div>
    );
  }

  const safeguarding = topic === SAFEGUARDING;

  return (
    // Pressed before the island hydrates, it posts to this page and sends
    // nothing; a POST keeps what was typed out of the address and logs.
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      ref={formRef}
      className="flex flex-col gap-6"
    >
      {text.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{text.alert}</p>
        </FormAlert>
      ) : null}

      <fieldset
        aria-describedby={text.errors.topic ? "topic-error" : undefined}
        className="flex flex-col gap-3"
      >
        <legend className="mb-2 font-semibold text-ink">
          {labels.topic.legend}
        </legend>
        {text.errors.topic ? (
          <p
            id="topic-error"
            className="flex items-start gap-2 font-semibold text-danger"
          >
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0"
            />
            <span>{text.errors.topic}</span>
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ...topics,
            { value: SAFEGUARDING, label: labels.safeguarding.label },
          ].map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 has-checked:border-link"
            >
              <input
                type="radio"
                name="topic"
                value={option.value}
                checked={topic === option.value}
                onChange={() => setTopic(option.value)}
                className="size-5 shrink-0 accent-link"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {safeguarding ? (
        <output className="block rounded-3xl border-2 border-danger-border bg-danger-bg p-5">
          <p className="flex items-center gap-2 font-bold">
            <ShieldAlert aria-hidden="true" className="size-5 text-danger" />
            {labels.safeguarding.label}
          </p>
          <p className="mt-1.5 text-ink">{labels.safeguarding.body}</p>
          <SiteLink href={ROUTES.safeguarding.path} className={LINK}>
            {labels.safeguarding.link}
          </SiteLink>
        </output>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField
              id="contact-name"
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              defaultValue={view.entered.name}
              label={labels.name.label}
              error={text.errors.name}
            />
            <TextField
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              required
              maxLength={254}
              defaultValue={view.entered.email}
              label={labels.email.label}
              hint={labels.email.hint}
              error={text.errors.email}
            />
          </div>
          <TextField
            id="contact-organisation"
            name="organisation"
            autoComplete="organization"
            maxLength={150}
            defaultValue={view.entered.organisation}
            label={labels.organisation.label}
            error={text.errors.organisation}
          />
          <TextField
            id="contact-subject"
            name="subject"
            required
            maxLength={150}
            defaultValue={view.entered.subject}
            label={labels.subject.label}
            error={text.errors.subject}
          />
          <MessageField
            label={labels.message.label}
            hint={labels.message.hint}
            error={text.errors.message}
            defaultValue={view.entered.message}
          />

          {/* The honeypot: out of sight and out of reach (inert), so only
              a bot fills it, and the server then drops the message. */}
          <div
            inert
            className="absolute -left-[9999px] size-px overflow-hidden"
          >
            <label htmlFor="contact-website">{labels.honeypot}</label>
            <input
              id="contact-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </div>

          <p className="text-sm text-ink-muted">
            {labels.privacy}{" "}
            <SiteLink href={ROUTES.privacy.path} className={LINK}>
              {labels.privacyLink}
            </SiteLink>
          </p>
          <div>
            <SubmitButton pending={sending} pendingLabel={labels.sending}>
              {labels.send}
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}

/** A labelled textarea, wired like TextField. */
function MessageField({
  label,
  hint,
  error,
  defaultValue,
}: {
  label: string;
  hint: string;
  error: string | undefined;
  defaultValue: string;
}) {
  const describedBy = ["contact-message-hint", error && "contact-message-error"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="contact-message" className="font-semibold text-ink">
        {label}
      </label>
      <p id="contact-message-hint" className="text-sm text-ink-muted">
        {hint}
      </p>
      {error ? (
        <p
          id="contact-message-error"
          className="flex items-start gap-2 font-semibold text-danger"
        >
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
      <textarea
        id="contact-message"
        name="message"
        required
        maxLength={5000}
        rows={7}
        defaultValue={defaultValue}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={inputStyles}
      />
    </div>
  );
}
