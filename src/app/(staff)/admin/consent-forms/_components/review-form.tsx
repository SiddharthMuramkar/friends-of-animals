"use client";

import { useActionState, useState } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form";
import type { Messages } from "@/i18n/messages";
import {
  REJECTION_NOTE_MAX,
  REJECTION_REASONS,
} from "@/server/modules/consent-forms/domain/review";

import { reviewSignedFormAction } from "../actions";

type ReviewLabels = Pick<
  Messages["adminConsentForms"],
  | "accept"
  | "acceptHint"
  | "reject"
  | "submitting"
  | "reason"
  | "chooseReason"
  | "reasons"
  | "note"
  | "noteHint"
  | "errors"
> & { problem: string };

export function ReviewForm({
  formId,
  canAccept,
  labels,
}: {
  formId: string;
  canAccept: boolean;
  labels: ReviewLabels;
}) {
  const [accept, submitAccept] = useActionState(
    reviewSignedFormAction.bind(null, formId, "accept"),
    {}
  );
  const [reject, submitReject] = useActionState(
    reviewSignedFormAction.bind(null, formId, "reject"),
    {}
  );
  const [reason, changeReason] = useState("");
  const [note, changeNote] = useState("");
  const rejected = reject.error;
  const noteError =
    rejected === "note_required" || rejected === "note_too_long"
      ? rejected
      : null;

  return (
    <div className="grid gap-5">
      {canAccept ? (
        <form
          action={submitAccept}
          aria-label={labels.accept}
          className="grid gap-3 justify-items-start"
        >
          <p>{labels.acceptHint}</p>
          {accept.error ? (
            <FormAlert tone="danger" label={labels.problem}>
              {labels.errors[accept.error]}
            </FormAlert>
          ) : null}
          <SubmitButton pendingLabel={labels.submitting}>
            {labels.accept}
          </SubmitButton>
        </form>
      ) : null}
      <form
        action={submitReject}
        aria-label={labels.reject}
        className="grid gap-4"
      >
        <SelectField
          id="consent-form-reason"
          name="reason"
          label={labels.reason}
          placeholder={labels.chooseReason}
          required
          options={REJECTION_REASONS.map((value) => ({
            value,
            label: labels.reasons[value],
          }))}
          value={reason}
          onChange={(event) => changeReason(event.currentTarget.value)}
        />
        <TextAreaField
          id="consent-form-note"
          name="note"
          label={labels.note}
          hint={labels.noteHint}
          error={
            noteError ? (
              <span role="alert">{labels.errors[noteError]}</span>
            ) : undefined
          }
          maxLength={REJECTION_NOTE_MAX}
          rows={3}
          value={note}
          onChange={(event) => changeNote(event.currentTarget.value)}
        />
        {reject.error && !noteError ? (
          <FormAlert tone="danger" label={labels.problem}>
            {labels.errors[reject.error]}
          </FormAlert>
        ) : null}
        <div>
          <SubmitButton variant="secondary" pendingLabel={labels.submitting}>
            {labels.reject}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
