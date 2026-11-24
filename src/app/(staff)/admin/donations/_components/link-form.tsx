"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";

import { makeReceiptLinkAction } from "../_lib/actions";
import { LINK_START } from "../_lib/link-state";

export type LinkFormLabels = {
  submit: string;
  submitting: string;
  problems: { cancelled: string; failed: string };
  problem: string;
  done: string;
};

/**
 * Finance makes a new 7-day receipt link (#106). It shows here, to open
 * or pass on by hand; nothing is emailed and the URL never holds it.
 */
export function LinkForm({
  donationId,
  origin,
  labels,
}: {
  donationId: string;
  origin: string;
  labels: LinkFormLabels;
}) {
  const [state, formAction] = useActionState(makeReceiptLinkAction, LINK_START);
  const url = state.link ? new URL(state.link.path, origin).href : null;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="donationId" value={donationId} />
      {state.problem ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.problems[state.problem]}</p>
        </FormAlert>
      ) : null}
      {url && state.link ? (
        <FormAlert tone="success" label={labels.done}>
          <p>{state.link.validUntil}</p>
          <p className="mt-2 font-mono text-sm wrap-anywhere">
            <a href={url} className="text-link underline">
              {url}
            </a>
          </p>
        </FormAlert>
      ) : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
