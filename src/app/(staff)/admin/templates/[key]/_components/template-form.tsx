"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { cn } from "@/lib/utils";

import { saveTemplateAction } from "../_lib/actions";
import type { TemplateFormState } from "../_lib/form-state";

export type TemplateFormLabels = {
  /** "Subject" for email, "Title" for in-app; null for SMS. */
  subject: string | null;
  body: string;
  dlt: string;
  dltHint: string;
  save: string;
  saving: string;
  saved: string;
  unchanged: string;
  stale: string;
  invalid: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  done: string;
};

/**
 * One channel of a template: its subject or title (not for SMS), its
 * message, and for SMS its DLT template id. Saves through
 * saveTemplateAction and shows what the use case said, keeping what was
 * typed after a refusal. Every word comes in `labels`.
 */
export function TemplateForm({
  templateKey,
  channel,
  initial,
  labels,
}: {
  templateKey: string;
  channel: "email" | "sms" | "in_app";
  initial: {
    subject: string;
    body: string;
    dltTemplateId: string;
    version: number;
  };
  labels: TemplateFormLabels;
}) {
  const [state, formAction] = useActionState(saveTemplateAction, {
    status: "idle",
    version: initial.version,
    fieldErrors: {},
    values: null,
  } satisfies TemplateFormState);
  const values = state.values ?? initial;
  const id = (field: string) => `${channel}-${field}`;
  const bodyError = state.fieldErrors.body;
  const savedText =
    state.status === "saved"
      ? labels.saved.replace("{version}", String(state.version))
      : null;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="key" value={templateKey} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="version" value={state.version} />

      {state.status === "refused" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{state.message}</p>
        </FormAlert>
      ) : state.status === "invalid" || state.status === "stale" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{state.status === "stale" ? labels.stale : labels.invalid}</p>
        </FormAlert>
      ) : savedText || state.status === "unchanged" ? (
        <FormAlert tone="success" label={labels.done}>
          <p>{savedText ?? labels.unchanged}</p>
        </FormAlert>
      ) : null}

      {labels.subject ? (
        <TextField
          // A new key resets the field to the saved value after a save.
          key={`subject-${state.version}`}
          id={id("subject")}
          name="subject"
          label={labels.subject}
          defaultValue={values.subject}
          maxLength={1000}
          error={state.fieldErrors.subject}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={id("body")} className="font-semibold text-ink">
          {labels.body}
        </label>
        {bodyError ? (
          <p
            id={id("body-error")}
            className="flex items-start gap-2 font-semibold text-danger"
          >
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0"
            />
            <span>{bodyError}</span>
          </p>
        ) : null}
        <textarea
          key={`body-${state.version}`}
          id={id("body")}
          name="body"
          rows={channel === "email" ? 10 : 4}
          defaultValue={values.body}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? id("body-error") : undefined}
          className={cn(inputStyles, "font-mono text-sm leading-relaxed")}
        />
      </div>

      {channel === "sms" ? (
        <TextField
          key={`dlt-${state.version}`}
          id={id("dlt")}
          name="dltTemplateId"
          label={labels.dlt}
          hint={labels.dltHint}
          inputMode="numeric"
          defaultValue={values.dltTemplateId}
          maxLength={100}
          error={state.fieldErrors.dltTemplateId}
        />
      ) : null}

      <div>
        <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}
