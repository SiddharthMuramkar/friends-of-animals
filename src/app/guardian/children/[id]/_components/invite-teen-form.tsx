"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";

import { inviteTeenAction } from "../../../_lib/actions";
import { INVITE_START, type InviteProblem } from "../../../_lib/form-state";

export type InviteTeenFormLabels = {
  email: { label: string; hint: string };
  problems: Record<InviteProblem, string>;
  submit: string;
  submitting: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * The teen's own email address, and a button (#81). The action comes back
 * to the child's page once it has sent the invitation, or returns why not
 * with the address typed.
 */
export function InviteTeenForm({
  childId,
  labels,
}: {
  childId: string;
  labels: InviteTeenFormLabels;
}) {
  const [state, formAction] = useActionState(
    inviteTeenAction.bind(null, childId),
    INVITE_START
  );
  const invalid = state.problem === "invalid_input";
  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.problem && !invalid ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.problems[state.problem]}</p>
        </FormAlert>
      ) : null}
      <TextField
        id="email"
        name="email"
        type="email"
        required
        autoComplete="off"
        spellCheck={false}
        maxLength={254}
        defaultValue={state.email}
        label={labels.email.label}
        hint={labels.email.hint}
        error={invalid ? labels.problems.invalid_input : undefined}
      />
      <div>
        <SubmitButton pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
