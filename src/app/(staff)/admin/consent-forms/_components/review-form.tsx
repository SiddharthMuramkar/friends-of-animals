"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form";
import {
  REJECTION_NOTE_MAX,
  REJECTION_REASONS,
} from "@/server/modules/consent-forms/domain/review";

import { reviewSignedFormAction } from "../actions";

export function ReviewForm({
  formId,
  canAccept,
}: {
  formId: string;
  canAccept: boolean;
}) {
  const t = useTranslations("adminConsentForms");
  const callout = useTranslations("common.callout");
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
          aria-label={t("accept")}
          className="grid gap-3 justify-items-start"
        >
          <p>{t("acceptHint")}</p>
          {accept.error ? (
            <FormAlert tone="danger" label={callout("danger")}>
              {t(`errors.${accept.error}`)}
            </FormAlert>
          ) : null}
          <SubmitButton pendingLabel={t("submitting")}>
            {t("accept")}
          </SubmitButton>
        </form>
      ) : null}
      <form
        action={submitReject}
        aria-label={t("reject")}
        className="grid gap-4"
      >
        <SelectField
          id="consent-form-reason"
          name="reason"
          label={t("reason")}
          placeholder={t("chooseReason")}
          required
          options={REJECTION_REASONS.map((value) => ({
            value,
            label: t(`reasons.${value}`),
          }))}
          value={reason}
          onChange={(event) => changeReason(event.currentTarget.value)}
        />
        <TextAreaField
          id="consent-form-note"
          name="note"
          label={t("note")}
          hint={t("noteHint")}
          error={
            noteError ? (
              <span role="alert">{t(`errors.${noteError}`)}</span>
            ) : undefined
          }
          maxLength={REJECTION_NOTE_MAX}
          rows={3}
          value={note}
          onChange={(event) => changeNote(event.currentTarget.value)}
        />
        {reject.error && !noteError ? (
          <FormAlert tone="danger" label={callout("danger")}>
            {t(`errors.${reject.error}`)}
          </FormAlert>
        ) : null}
        <div>
          <SubmitButton variant="secondary" pendingLabel={t("submitting")}>
            {t("reject")}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
