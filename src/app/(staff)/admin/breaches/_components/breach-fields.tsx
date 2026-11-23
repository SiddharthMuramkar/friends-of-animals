"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";
import {
  BREACH_AFFECTED_COUNT_MAX,
  BREACH_IMPACT_MAX,
  BREACH_SEVERITIES,
  BREACH_TITLE_MAX,
} from "@/server/modules/breaches/domain/breach-status";
import type { BreachDetailsState, BreachDraft } from "../_lib/details-state";

export function BreachCheckbox({
  name,
  label,
  checked,
  required,
}: {
  name: string;
  label: string;
  checked?: boolean;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={checked}
        required={required}
        className="size-5 shrink-0 accent-current"
      />
      <label
        htmlFor={name}
        className="flex min-h-11 items-center font-semibold"
      >
        {label}
      </label>
    </div>
  );
}

export type BreachFormLabels = {
  form: string;
  submit: string;
  pending: string;
  problem: string;
  invalid: string;
  awareInFuture: string;
  fields: Record<keyof BreachDraft | "titleHint" | "chooseSeverity", string>;
  errors: Record<keyof BreachDraft, string>;
  severities: Record<(typeof BREACH_SEVERITIES)[number], string>;
};

export function BreachDetailsForm({
  action,
  labels,
  initial,
  headingId,
}: {
  action: (
    state: BreachDetailsState,
    formData: FormData
  ) => Promise<BreachDetailsState>;
  labels: BreachFormLabels;
  initial?: Partial<BreachDraft>;
  headingId?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const draft = state?.draft ?? initial;
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state) return;
    const field = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]'
    );
    (field ?? summary.current)?.focus();
  }, [state]);
  const error = (field: keyof BreachDraft) =>
    state?.invalidFields.includes(field)
      ? field === "awareAt" && state.awareInFuture
        ? labels.awareInFuture
        : labels.errors[field]
      : undefined;
  const { fields } = labels;
  return (
    <form
      key={state?.attempt ?? 0}
      ref={form}
      action={formAction}
      aria-label={headingId ? undefined : labels.form}
      aria-labelledby={headingId}
      className={headingId ? "mt-5 flex flex-col gap-4" : "flex flex-col gap-4"}
    >
      {state ? (
        <div ref={summary} tabIndex={-1}>
          <FormAlert tone="danger" label={labels.problem}>
            <p>{labels.invalid}</p>
          </FormAlert>
        </div>
      ) : null}
      <TextField
        id="breach-title"
        name="title"
        label={fields.title}
        hint={fields.titleHint}
        error={error("title")}
        defaultValue={draft?.title}
        maxLength={BREACH_TITLE_MAX}
        required
      />
      {initial ? null : (
        <TextField
          id="breach-aware-at"
          name="awareAt"
          type="datetime-local"
          label={fields.awareAt}
          defaultValue={draft?.awareAt}
          error={error("awareAt")}
          required
        />
      )}
      <SelectField
        id="breach-severity"
        name="severity"
        label={fields.severity}
        error={error("severity")}
        placeholder={fields.chooseSeverity}
        options={BREACH_SEVERITIES.map((value) => ({
          value,
          label: labels.severities[value],
        }))}
        defaultValue={draft?.severity ?? ""}
        required
      />
      <TextField
        id="breach-affected-count"
        name="affectedCount"
        type="number"
        min={0}
        max={BREACH_AFFECTED_COUNT_MAX}
        step={1}
        label={fields.affectedCount}
        error={error("affectedCount")}
        defaultValue={draft?.affectedCount}
        required
      />
      <div className="flex flex-col">
        <BreachCheckbox
          name="personalDataInvolved"
          label={fields.personalDataInvolved}
          checked={draft?.personalDataInvolved}
        />
        <BreachCheckbox
          name="minorsAffected"
          label={fields.minorsAffected}
          checked={draft?.minorsAffected}
        />
      </div>
      <TextAreaField
        id="breach-impact"
        name="impact"
        label={fields.impact}
        error={error("impact")}
        defaultValue={draft?.impact}
        maxLength={BREACH_IMPACT_MAX}
        rows={4}
        required
      />
      <SubmitButton className="self-start" pendingLabel={labels.pending}>
        {labels.submit}
      </SubmitButton>
    </form>
  );
}
