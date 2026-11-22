"use client";

import { OctagonAlert } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";
import { SiteLink } from "@/components/site/site-link";
import { fillWaitMs } from "@/lib/form-fill-time";
import { solveProofOfWork } from "@/lib/proof-of-work";
import { ROUTES } from "@/lib/routes";

import {
  issueConcernChallengeAction,
  submitConcernAction,
} from "../_lib/actions";
import { START_VIEW, type ConcernFormView } from "../_lib/form-state";

export type ConcernFormLabels = {
  category: { legend: string };
  description: { label: string; hint: string };
  subjectDetails: { label: string; hint: string };
  subjectAge: { label: string; unknown: string };
  reporterIsChild: string;
  anonymous: { label: string; hint: string };
  reporterName: { label: string };
  reporterContact: { label: string; hint: string };
  honeypot: string;
  privacy: string;
  privacyLink: string;
  send: string;
  sending: string;
  /** common.callout's word for a problem: meaning never by colour alone. */
  problem: string;
};

type Option = { value: string; label: string };

/** Mirrors the use case's limits, so the browser stops overlong text. */
const MAX = {
  description: 5000,
  subjectDetails: 1000,
  reporterName: 120,
  reporterContact: 200,
} as const;

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 has-checked:border-link";

type Proof = {
  token: string;
  nonce: number;
  /** When the challenge reached this page, on performance.now(). */
  receivedAt: number;
  /** From then (page time), the proof is replaced instead of sent. */
  staleAt: number;
};

/** A proof this close to expiring is replaced, not sent. */
const EXPIRY_MARGIN_MS = 60_000;

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The "report a concern" island on the prerendered /safeguarding/report
 * page (#116). When the form first gets focus it fetches a human-check
 * challenge and solves it in the background (src/lib/proof-of-work.ts).
 *
 * A real report must never meet the bot screen, which drops a form sent
 * within 3 seconds of its challenge as if it had worked. So Send waits out
 * whatever is left of that clock, timed from when the challenge arrived
 * (src/lib/form-fill-time.ts), and after a refused check a new challenge
 * starts at once, not when Send is pressed again. Every time is the page's
 * own (performance.now()), so a wrong device clock doesn't matter.
 *
 * Every message comes translated from the action; static words come in
 * `labels`; `help` (helplines and the safeguarding email) shows with any
 * problem, so a report that can't be sent still leaves a way to get help.
 */
export function ConcernForm({
  labels,
  categories,
  ages,
  help,
}: {
  labels: ConcernFormLabels;
  categories: readonly Option[];
  ages: readonly Option[];
  help: ReactNode;
}) {
  const proof = useRef<Promise<Proof> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /** The proof for the next send, started once and reused until spent. */
  function humanCheck(): Promise<Proof> {
    const current = proof.current;
    if (current) return current;
    const next = (async () => {
      const challenge = await issueConcernChallengeAction();
      const receivedAt = performance.now();
      const nonce = await solveProofOfWork(challenge);
      return {
        token: challenge.token,
        nonce,
        receivedAt,
        staleAt: receivedAt + challenge.expiresInMs - EXPIRY_MARGIN_MS,
      };
    })();
    proof.current = next;
    // A failed fetch is tried again on the next send.
    next.catch(() => {
      if (proof.current === next) proof.current = null;
    });
    return next;
  }

  async function send(previous: ConcernFormView, formData: FormData) {
    try {
      let ready = await humanCheck();
      if (performance.now() >= ready.staleAt) {
        proof.current = null;
        ready = await humanCheck();
      }
      await wait(fillWaitMs(ready.receivedAt, performance.now()));
      formData.set("humanCheckToken", ready.token);
      formData.set("humanCheckNonce", String(ready.nonce));
    } catch {
      // Sent without a proof, the server answers "human check failed",
      // and the form asks for Send again with a new challenge under way.
    }
    const next = await submitConcernAction(previous, formData);
    // The server checks the fields before it spends the proof, so a form
    // sent back for its fields keeps it. Any other answer spent or refused
    // it: the next send needs a new one.
    if (next.fieldErrors === undefined) proof.current = null;
    return next;
  }

  const [view, formAction, sending] = useActionState(send, START_VIEW);

  // Sent from the submit event, not a form `action`: React prerenders a
  // client action as a javascript: URL, which the CSP blocks
  // (scripts/csp-output.ts). The form status only follows `action`, so the
  // button gets the action's own pending state.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  // Start solving when the reporter reaches the form; a later focus finds
  // the proof ready, or tries again after a failed fetch.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const start = () => void humanCheck().catch(() => undefined);
    form.addEventListener("focusin", start);
    return () => form.removeEventListener("focusin", start);
  });

  // After a refused try, get the next proof going now, so its clock has run
  // by the time the reporter presses Send again.
  useEffect(() => {
    if (view.alert) void humanCheck().catch(() => undefined);
  });

  const { text, entered } = view;
  const [anonymous, setAnonymous] = useState(entered.anonymous);

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
          <div className="mt-3">{help}</div>
        </FormAlert>
      ) : null}

      <fieldset
        aria-describedby={text.errors.category ? "category-error" : undefined}
        className="flex flex-col gap-3"
      >
        <legend className="mb-2 font-semibold text-ink">
          {labels.category.legend}
        </legend>
        {text.errors.category ? (
          <p
            id="category-error"
            className="flex items-start gap-2 font-semibold text-danger"
          >
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0"
            />
            <span>{text.errors.category}</span>
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {categories.map((option) => (
            <label key={option.value} className={CHOICE}>
              <input
                type="radio"
                name="category"
                value={option.value}
                required
                defaultChecked={entered.category === option.value}
                className="size-5 shrink-0 accent-link"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <TextAreaField
        id="concern-description"
        name="description"
        required
        maxLength={MAX.description}
        rows={7}
        defaultValue={entered.description}
        label={labels.description.label}
        hint={labels.description.hint}
        error={text.errors.description}
      />
      <TextField
        id="concern-subject"
        name="subjectDetails"
        maxLength={MAX.subjectDetails}
        autoComplete="off"
        defaultValue={entered.subjectDetails}
        label={labels.subjectDetails.label}
        hint={labels.subjectDetails.hint}
        error={text.errors.subjectDetails}
      />
      <SelectField
        id="concern-age"
        name="subjectAge"
        defaultValue={entered.subjectAge}
        label={labels.subjectAge.label}
        placeholder={labels.subjectAge.unknown}
        options={[...ages]}
        error={text.errors.subjectAge}
      />

      <label className={CHOICE}>
        <input
          type="checkbox"
          name="reporterIsChild"
          defaultChecked={entered.reporterIsChild}
          className="size-5 shrink-0 accent-link"
        />
        <span>{labels.reporterIsChild}</span>
      </label>

      <div className="flex flex-col gap-2">
        <label className={CHOICE}>
          <input
            type="checkbox"
            name="anonymous"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
            aria-describedby="concern-anonymous-hint"
            className="size-5 shrink-0 accent-link"
          />
          <span>{labels.anonymous.label}</span>
        </label>
        <p id="concern-anonymous-hint" className="text-sm text-ink-muted">
          {labels.anonymous.hint}
        </p>
      </div>

      {anonymous ? null : (
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            id="concern-name"
            name="reporterName"
            autoComplete="name"
            maxLength={MAX.reporterName}
            defaultValue={entered.reporterName}
            label={labels.reporterName.label}
            error={text.errors.reporterName}
          />
          <TextField
            id="concern-contact"
            name="reporterContact"
            autoComplete="email"
            spellCheck={false}
            maxLength={MAX.reporterContact}
            defaultValue={entered.reporterContact}
            label={labels.reporterContact.label}
            hint={labels.reporterContact.hint}
            error={text.errors.reporterContact}
          />
        </div>
      )}

      {/* The honeypot: out of sight and out of reach (inert), so only a
          bot fills it, and the server then drops the report. */}
      <div inert className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="concern-website">{labels.honeypot}</label>
        <input
          id="concern-website"
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
    </form>
  );
}
