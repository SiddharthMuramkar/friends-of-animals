"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";

import { inviteCoordinatorAction } from "../_lib/actions";
import { START_VIEW } from "../_lib/invite-state";

export type InviteFormLabels = {
  identifier: { label: string; hint: string };
  invite: string;
  inviting: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  done: string;
};

/**
 * One field, an email or a mobile number, and a button. Every message
 * comes translated from the action; static words come in `labels`.
 */
export function InviteForm({
  institutionId,
  labels,
}: {
  institutionId: string;
  labels: InviteFormLabels;
}) {
  const [view, formAction] = useActionState(
    inviteCoordinatorAction,
    START_VIEW
  );
  const { text } = view;
  const invalid = view.problem === "invalid_input";

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="institutionId" value={institutionId} />
      {text.problem && !invalid ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{text.problem}</p>
        </FormAlert>
      ) : text.sent ? (
        <FormAlert tone="success" label={labels.done}>
          <p className="wrap-anywhere">{text.sent}</p>
        </FormAlert>
      ) : null}
      <TextField
        // A new key after each send empties the field for the next one.
        key={view.sentTo ?? "entry"}
        id="identifier"
        name="identifier"
        autoComplete="off"
        spellCheck={false}
        required
        maxLength={320}
        defaultValue={view.identifier}
        label={labels.identifier.label}
        hint={labels.identifier.hint}
        error={invalid ? text.problem : undefined}
      />
      <div>
        <SubmitButton pendingLabel={labels.inviting}>
          {labels.invite}
        </SubmitButton>
      </div>
    </form>
  );
}
