"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";

import { recordManualRefundAction } from "../_lib/actions";
import { MANUAL_START, type ManualFormState } from "../_lib/form-state";

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 has-checked:border-link";

const METHODS = ["bank_transfer", "cheque", "cash"] as const;

export type ManualFormLabels = {
  method: { legend: string; options: Record<(typeof METHODS)[number], string> };
  reference: { label: string; hint: string };
  errors: Record<NonNullable<ManualFormState["error"]>, string>;
  alerts: Record<NonNullable<ManualFormState["alert"]>, string>;
  submit: string;
  saving: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/** How finance paid a refund back by hand, and its reference. */
export function ManualForm({
  refundId,
  labels,
}: {
  refundId: string;
  labels: ManualFormLabels;
}) {
  const [state, formAction] = useActionState(
    recordManualRefundAction,
    MANUAL_START
  );
  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="refundId" value={refundId} />
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-ink">
          {labels.method.legend}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {METHODS.map((method) => (
            <label key={method} className={CHOICE}>
              <input
                type="radio"
                name="method"
                value={method}
                defaultChecked={state.method === method}
                className="size-5 shrink-0 accent-link"
              />
              <span>{labels.method.options[method]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextField
        id="manual-reference"
        name="reference"
        label={labels.reference.label}
        hint={labels.reference.hint}
        error={state.error ? labels.errors[state.error] : undefined}
        defaultValue={state.reference}
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
      />
      <div>
        <SubmitButton pendingLabel={labels.saving}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
