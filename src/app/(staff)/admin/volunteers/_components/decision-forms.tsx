"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextAreaField } from "@/components/form";

import { approveAction, declineAction } from "../_lib/actions";
import { IDLE, type DecisionState } from "../_lib/form-state";

// The community team's two decisions on a submitted volunteer application
// (#123): approve, which grants the volunteer role, or decline with the
// reason the applicant is told. Each sends to its Server Action, so it
// works before the page hydrates, and shows what the use case said. Every
// word comes in props.

/** common.callout words: meaning never by colour alone. */
type CalloutLabels = { problem: string };

function Refusal({
  state,
  labels,
}: {
  state: DecisionState;
  labels: CalloutLabels;
}) {
  if (state.message === null) return null;
  return (
    <FormAlert tone="danger" label={labels.problem}>
      <p>{state.message}</p>
    </FormAlert>
  );
}

export function ApproveForm({
  applicationId,
  labels,
}: {
  applicationId: string;
  labels: CalloutLabels & { body: string; submit: string; saving: string };
}) {
  const [state, formAction] = useActionState(approveAction, IDLE);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Refusal state={state} labels={labels} />
      <p className="text-ink">{labels.body}</p>
      <div>
        <SubmitButton pendingLabel={labels.saving}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeclineForm({
  applicationId,
  maxLength,
  labels,
}: {
  applicationId: string;
  maxLength: number;
  labels: CalloutLabels & {
    reason: string;
    hint: string;
    submit: string;
    saving: string;
  };
}) {
  const [state, formAction] = useActionState(declineAction, IDLE);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="applicationId" value={applicationId} />
      {/* A refusal is said at the reason, which it is about. */}
      <TextAreaField
        id="decline-reason"
        name="reason"
        rows={4}
        required
        maxLength={maxLength}
        label={labels.reason}
        hint={labels.hint}
        error={state.message ?? undefined}
        defaultValue={state.typed}
      />
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.saving}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
