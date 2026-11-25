"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState, type ReactNode } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";

import type {
  AnimalField,
  AnimalFormAlert,
  AnimalFormState,
  AnimalFormValues,
} from "../_lib/form-state";

type FieldLabels = { label: string; hint?: string; error: string };
type Option = { value: string; label: string };

export type AnimalFormLabels = {
  sections: Record<"animal" | "health" | "adoption" | "place", string>;
  fields: Record<Exclude<AnimalField, "age">, FieldLabels> & {
    age: FieldLabels & { years: string; months: string };
  };
  options: Record<
    "species" | "sex" | "size" | "sterilised" | "state",
    Option[]
  >;
  alerts: Record<AnimalFormAlert, string>;
  submit: string;
  submitting: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const FIELDSET =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LEGEND = "px-2 text-lead font-bold text-ink";

function ErrorLine({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p
      id={`${id}-error`}
      className="flex items-start gap-2 font-semibold text-danger"
    >
      <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{error}</span>
    </p>
  ) : null;
}

function Select({
  id,
  labels,
  options,
  value,
  error,
}: {
  id: keyof AnimalFormValues;
  labels: FieldLabels;
  options: Option[];
  value: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold text-ink">
        {labels.label}
      </label>
      <ErrorLine id={id} error={error} />
      <select
        id={id}
        name={id}
        defaultValue={value}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className={inputStyles}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * An animal's details for adoption, in four groups: adding one and
 * editing one. Every word comes in `labels`; the action returns which
 * fields to fix and keeps what was typed.
 */
export function AnimalForm({
  action,
  start,
  labels,
  hidden,
}: {
  action: (
    previous: AnimalFormState,
    formData: FormData
  ) => Promise<AnimalFormState>;
  start: AnimalFormState;
  labels: AnimalFormLabels;
  /** Hidden fields the action needs, such as the listing's id. */
  hidden: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, start);
  const values = state.values;
  const errorOf = (field: AnimalField) =>
    state.errors.includes(field) ? labels.fields[field].error : undefined;
  const text = (
    field: "name" | "breed" | "colour" | "city" | "pinCode",
    input: Partial<Parameters<typeof TextField>[0]> = {}
  ) => (
    <TextField
      id={field}
      name={field}
      defaultValue={values[field]}
      label={labels.fields[field].label}
      hint={labels.fields[field].hint}
      error={errorOf(field)}
      {...input}
    />
  );
  const area = (
    field: "about" | "healthNotes" | "vaccinationNotes" | "conditions",
    max: number,
    extra: { required?: boolean } = {}
  ): ReactNode => (
    <TextAreaField
      id={field}
      name={field}
      rows={4}
      maxLength={max}
      defaultValue={values[field]}
      label={labels.fields[field].label}
      hint={labels.fields[field].hint}
      error={errorOf(field)}
      {...extra}
    />
  );
  const select = (
    field: "species" | "sex" | "size" | "sterilised" | "state"
  ) => (
    <Select
      id={field}
      labels={labels.fields[field]}
      options={labels.options[field]}
      value={values[field]}
      error={errorOf(field)}
    />
  );
  const ageError = errorOf("age");

  return (
    // A new key per submission remounts the inputs with what was typed:
    // React resets a form after its action runs.
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-8"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.animal}</legend>
        {text("name", { required: true, maxLength: 60 })}
        {select("species")}
        {text("breed", { maxLength: 60 })}
        {select("sex")}
        {select("size")}
        {text("colour", { maxLength: 40 })}
        <fieldset
          aria-describedby={["age-hint", ageError ? "age-error" : ""]
            .filter(Boolean)
            .join(" ")}
          className="flex flex-col gap-2"
        >
          <legend className="font-semibold text-ink">
            {labels.fields.age.label}
          </legend>
          <p id="age-hint" className="text-sm text-ink-muted">
            {labels.fields.age.hint}
          </p>
          <ErrorLine id="age" error={ageError} />
          <div className="grid grid-cols-2 gap-4">
            <TextField
              id="ageYears"
              name="ageYears"
              label={labels.fields.age.years}
              defaultValue={values.ageYears}
              inputMode="numeric"
              maxLength={2}
              aria-describedby={ageError ? "age-error" : undefined}
            />
            <TextField
              id="ageMonths"
              name="ageMonths"
              label={labels.fields.age.months}
              defaultValue={values.ageMonths}
              inputMode="numeric"
              maxLength={2}
              aria-describedby={ageError ? "age-error" : undefined}
            />
          </div>
        </fieldset>
        {area("about", 3000)}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.health}</legend>
        {select("sterilised")}
        {area("healthNotes", 4000)}
        {area("vaccinationNotes", 2000)}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.adoption}</legend>
        {area("conditions", 4000, { required: true })}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.place}</legend>
        {select("state")}
        {text("city", {
          required: true,
          autoComplete: "address-level2",
          maxLength: 80,
        })}
        {text("pinCode", {
          required: true,
          inputMode: "numeric",
          autoComplete: "postal-code",
          maxLength: 6,
        })}
      </fieldset>

      <div>
        <SubmitButton size="lg" pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
