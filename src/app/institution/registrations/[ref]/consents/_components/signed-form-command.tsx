"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import type { Messages } from "@/i18n/messages";

import { signedFormCommandAction } from "../signed-form-actions";

export type SignedFormFeedback = {
  errors: Messages["adminConsentForms"]["errors"];
  problem: string;
};

export function SignedFormCommand({
  command,
  label,
  accessibleName = label,
  pendingLabel,
  feedback,
}: {
  command: Parameters<typeof signedFormCommandAction>[0];
  label: string;
  accessibleName?: string;
  pendingLabel: string;
  feedback: SignedFormFeedback;
}) {
  const [state, action] = useActionState(
    signedFormCommandAction.bind(null, command),
    {}
  );
  return (
    <form
      action={action}
      aria-label={accessibleName}
      className="grid justify-items-start gap-3"
    >
      {state.error ? (
        <FormAlert tone="danger" label={feedback.problem}>
          {feedback.errors[state.error]}
        </FormAlert>
      ) : null}
      <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}
