"use client";

import { useActionState } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";

import {
  placeHoldAction,
  releaseHoldAction,
  type HoldFormState,
} from "../_lib/actions";

export type HoldFormLabels = {
  place: string;
  placing: string;
  release: string;
  releasing: string;
  done: string;
  problem: string;
};

function Outcome({
  state,
  labels,
}: {
  state: HoldFormState;
  labels: HoldFormLabels;
}) {
  return state ? (
    <FormAlert
      tone={state.ok ? "success" : "danger"}
      label={state.ok ? labels.done : labels.problem}
    >
      <p>{state.message}</p>
    </FormAlert>
  ) : null;
}

export function PlaceHoldForm({
  labels,
  types,
  maxReasonLength,
}: {
  labels: HoldFormLabels & {
    title: string;
    type: string;
    chooseType: string;
    id: string;
    idHint: string;
    reason: string;
    reasonHint: string;
  };
  types: { value: string; label: string }[];
  maxReasonLength: number;
}) {
  const [state, formAction] = useActionState(placeHoldAction, null);
  return (
    <form
      action={formAction}
      aria-labelledby="place-hold-title"
      className="flex max-w-lg flex-col gap-4"
    >
      <h3 id="place-hold-title" className="font-semibold text-ink">
        {labels.title}
      </h3>
      <Outcome state={state} labels={labels} />
      <SelectField
        id="hold-subject-type"
        name="subjectType"
        label={labels.type}
        placeholder={labels.chooseType}
        options={types}
        required
      />
      <TextField
        id="hold-subject-id"
        name="subjectId"
        label={labels.id}
        hint={labels.idHint}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <TextAreaField
        id="hold-reason"
        name="reason"
        label={labels.reason}
        hint={labels.reasonHint}
        maxLength={maxReasonLength}
        rows={3}
        required
      />
      <div>
        <SubmitButton pendingLabel={labels.placing}>
          {labels.place}
        </SubmitButton>
      </div>
    </form>
  );
}

export function ReleaseHoldForm({
  holdId,
  labelId,
  labels,
}: {
  holdId: string;
  labelId: string;
  labels: HoldFormLabels;
}) {
  const [state, formAction] = useActionState(releaseHoldAction, null);
  return (
    <form
      action={formAction}
      aria-labelledby={labelId}
      className="mt-4 flex flex-col items-start gap-3"
    >
      <input type="hidden" name="holdId" value={holdId} />
      <Outcome state={state} labels={labels} />
      <SubmitButton variant="secondary" pendingLabel={labels.releasing}>
        {labels.release}
      </SubmitButton>
    </form>
  );
}
