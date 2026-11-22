"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";

import { declareGuardianAction } from "../../_lib/actions";
import {
  DECLARE_START,
  type DeclareField,
  type DeclareProblem,
  type DeclareValues,
} from "../../_lib/form-state";

export type DeclareFormLabels = {
  fields: Record<DeclareField, string>;
  phoneHint: string;
  invalid: Record<DeclareField, string>;
  problems: Record<DeclareProblem, string>;
  fixFields: string;
  submit: string;
  submitting: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const FIELDSET =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/**
 * The guardian's declaration (#81): their name, an optional phone and the
 * adult-and-guardian box. Every word comes in `labels`; the action emails
 * the code and moves on, or returns what to fix with what was typed.
 */
export function DeclareForm({
  initial,
  labels,
}: {
  /** What an unverified guardian declared last time, to correct. */
  initial: Omit<DeclareValues, "adultDeclared">;
  labels: DeclareFormLabels;
}) {
  const [state, formAction] = useActionState(declareGuardianAction, {
    ...DECLARE_START,
    values: { ...DECLARE_START.values, ...initial },
  });
  const { values } = state;
  const errorOf = (field: DeclareField) =>
    state.errors.includes(field) ? labels.invalid[field] : undefined;
  const declaredError = errorOf("adultDeclared");
  const formLevel = state.problem
    ? labels.problems[state.problem]
    : state.errors.length > 0
      ? labels.fixFields
      : null;

  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-8"
    >
      {formLevel ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{formLevel}</p>
        </FormAlert>
      ) : null}
      <div className={FIELDSET}>
        <TextField
          id="fullName"
          name="fullName"
          required
          autoComplete="name"
          maxLength={100}
          defaultValue={values.fullName}
          label={labels.fields.fullName}
          error={errorOf("fullName")}
        />
        <TextField
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={32}
          defaultValue={values.phone}
          label={labels.fields.phone}
          hint={labels.phoneHint}
          error={errorOf("phone")}
        />
        <div className="flex flex-col gap-2">
          {declaredError ? (
            <p
              id="adultDeclared-error"
              className="flex items-start gap-2 font-semibold text-danger"
            >
              <OctagonAlert
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0"
              />
              <span>{declaredError}</span>
            </p>
          ) : null}
          <label className="flex min-h-11 items-start gap-3 font-semibold text-ink">
            <input
              type="checkbox"
              name="adultDeclared"
              required
              defaultChecked={values.adultDeclared}
              aria-invalid={declaredError ? true : undefined}
              aria-describedby={
                declaredError ? "adultDeclared-error" : undefined
              }
              className="mt-0.5 size-6 shrink-0 accent-primary"
            />
            <span className="min-w-0">{labels.fields.adultDeclared}</span>
          </label>
        </div>
      </div>
      <div>
        <SubmitButton pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
