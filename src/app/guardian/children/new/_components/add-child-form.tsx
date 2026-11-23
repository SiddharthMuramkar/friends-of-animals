"use client";

import { useActionState } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/form";

import { addChildAction } from "../../../_lib/actions";
import {
  ADD_CHILD_START,
  type AddChildField,
  type AddChildRefusal,
} from "../../../_lib/form-state";

export type AddChildFormLabels = {
  fields: Record<AddChildField, string>;
  relationshipPlaceholder: string;
  relationships: { value: string; label: string }[];
  invalid: Record<AddChildField, string>;
  refusals: Record<AddChildRefusal, string>;
  fixFields: string;
  submit: string;
  submitting: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const FIELDSET =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/**
 * A child's name, date of birth and how the guardian is related to them
 * (#81). The action opens the child's page, or returns what to fix.
 */
export function AddChildForm({ labels }: { labels: AddChildFormLabels }) {
  const [state, formAction] = useActionState(addChildAction, ADD_CHILD_START);
  const { values } = state;
  const errorOf = (field: AddChildField): string | undefined => {
    if (!state.errors.includes(field)) return undefined;
    // A refusal tied to the field says why in its own words.
    return state.refusal
      ? labels.refusals[state.refusal]
      : labels.invalid[field];
  };
  const formLevel =
    state.refusal && state.errors.length === 0
      ? labels.refusals[state.refusal]
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
          autoComplete="off"
          maxLength={100}
          defaultValue={values.fullName}
          label={labels.fields.fullName}
          error={errorOf("fullName")}
        />
        <TextField
          id="dateOfBirth"
          name="dateOfBirth"
          type="date"
          required
          defaultValue={values.dateOfBirth}
          label={labels.fields.dateOfBirth}
          error={errorOf("dateOfBirth")}
        />
        <SelectField
          id="relationship"
          name="relationship"
          required
          defaultValue={values.relationship}
          label={labels.fields.relationship}
          placeholder={labels.relationshipPlaceholder}
          options={labels.relationships}
          error={errorOf("relationship")}
        />
      </div>
      <div>
        <SubmitButton pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
