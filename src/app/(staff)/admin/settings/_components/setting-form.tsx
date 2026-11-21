"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import type { SettingInput } from "@/server/settings";

import { changeSettingAction, type SettingFormView } from "../_lib/actions";

export type SettingFormLabels = {
  /** The legend of an On/Off choice, or the label of a number. */
  newValue: string;
  /** "A whole number from 1 to 24." for a number. */
  range?: string;
  on: string;
  off: string;
  save: string;
  saving: string;
  done: string;
  problem: string;
};

const START: SettingFormView = { status: "idle" };

/**
 * Changes one setting: an On/Off choice or a whole number, then Save. The
 * outcome shows above the field; a refused number stays as typed, with
 * the reason beside it. `value` is what applies now; the page refreshes
 * after a save, so it is the new value from then on.
 */
export function SettingForm({
  settingKey,
  input,
  value,
  labels,
}: {
  settingKey: string;
  input: SettingInput;
  value: boolean | number;
  labels: SettingFormLabels;
}) {
  const [view, formAction] = useActionState(changeSettingAction, START);
  const id = `setting-${settingKey.replace(/\W/g, "-")}`;
  const invalid = view.status === "invalid";

  return (
    // noValidate: the server says what's wrong, in FOA's words, the same
    // way for every browser.
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="key" value={settingKey} />

      {view.status === "saved" || view.status === "unchanged" ? (
        <FormAlert tone="success" label={labels.done}>
          <p>{view.message}</p>
        </FormAlert>
      ) : view.status === "refused" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.message}</p>
        </FormAlert>
      ) : null}

      {input.kind === "boolean" ? (
        <fieldset
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="flex flex-col gap-2"
        >
          <legend className="font-semibold text-ink">{labels.newValue}</legend>
          {invalid ? (
            <p id={`${id}-error`} className="font-semibold text-danger">
              {view.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {[
              { option: true, label: labels.on },
              { option: false, label: labels.off },
            ].map(({ option, label }) => (
              <label
                key={label}
                className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-full border-2 border-border-strong bg-surface px-4 font-semibold text-ink hover:border-ink has-checked:border-ink has-checked:bg-surface-muted has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
              >
                <input
                  type="radio"
                  name="value"
                  value={String(option)}
                  defaultChecked={value === option}
                  className="size-5 accent-ink"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <TextField
          id={`${id}-value`}
          name="value"
          type="number"
          inputMode="numeric"
          min={input.min}
          max={input.max}
          step={1}
          required
          defaultValue={invalid ? view.entered : String(value)}
          label={labels.newValue}
          hint={labels.range}
          error={invalid ? view.message : undefined}
          className="max-w-xs"
        />
      )}

      <div>
        <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}
