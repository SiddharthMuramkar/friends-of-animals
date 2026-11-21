"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton } from "@/components/form";

import { revokeRoleAction } from "../_lib/actions";
import { EMPTY_ROLE_FORM } from "../_lib/form-view";

/**
 * Takes one grant away. A refusal (the last super admin, say) shows above
 * the button; a revoke that worked reloads the page without the grant.
 */
export function RevokeForm({
  userId,
  query,
  grant,
  labels,
}: {
  userId: string;
  query: string;
  grant: { role: string; scopeType: string; scopeId: string };
  labels: {
    submit: string;
    /** The whole sentence for screen readers: "Remove Judge, everywhere". */
    submitFor: string;
    pending: string;
    problem: string;
  };
}) {
  const [view, formAction] = useActionState(revokeRoleAction, EMPTY_ROLE_FORM);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="q" value={query} />
      <input type="hidden" name="role" value={grant.role} />
      <input type="hidden" name="scopeType" value={grant.scopeType} />
      <input type="hidden" name="scopeId" value={grant.scopeId} />
      {view.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.alert}</p>
        </FormAlert>
      ) : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.pending}>
          {/* It starts with the visible word (WCAG 2.5.3). */}
          <span aria-hidden="true">{labels.submit}</span>
          <span className="sr-only">{labels.submitFor}</span>
        </SubmitButton>
      </div>
    </form>
  );
}
