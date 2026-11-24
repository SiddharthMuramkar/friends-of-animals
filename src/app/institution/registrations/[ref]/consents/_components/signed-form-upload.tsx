"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { completeUploadAction } from "@/app/account/files/_lib/actions";
import { putHeaders } from "@/app/account/files/_lib/upload";
import { FormAlert, SubmitButton } from "@/components/form";
import { inputStyles } from "@/components/form/text-field";
import type { PublicPurpose } from "@/server/modules/consent/domain/public-use";
import { PURPOSE_RULES } from "@/server/modules/files/domain/purposes";
import type { Messages } from "@/i18n/messages";
import type { UseCases } from "@/server/app";

import {
  requestSignedFormUploadAction,
  submitSignedFormAction,
} from "../signed-form-actions";
import type { SignedFormFeedback } from "./signed-form-command";

type UploadError = keyof Messages["adminConsentForms"]["errors"];

export function SignedFormUpload({
  target,
  offers,
  labels,
  feedback,
}: {
  target: Omit<
    Parameters<UseCases["requestConsentFormUpload"]>[0],
    "contentType" | "sizeBytes"
  >;
  offers: {
    purpose: PublicPurpose;
    id: string;
    label: string;
    versionLabel: string;
  }[];
  labels: Pick<
    Messages["adminConsentForms"]["coordinator"],
    "file" | "limits" | "uses" | "submit" | "uploading"
  > & {
    accessibleName: string;
  };
  feedback: SignedFormFeedback;
}) {
  const fieldId = useId();
  const scan = useRef<HTMLInputElement>(null);
  const [pending, startUpload] = useTransition();
  const [error, setError] = useState<UploadError | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const file = scan.current?.files?.[0];
    const checked = new FormData(form).getAll("uses");
    const selected = offers.filter(({ purpose }) => checked.includes(purpose));
    if (!file || file.size === 0) return setError("empty");
    if (selected.length === 0) return setError("no_uses");
    setError(null);
    startUpload(async () => {
      try {
        const upload = await requestSignedFormUploadAction({
          ...target,
          contentType: file.type,
          sizeBytes: file.size,
        });
        if (!upload.ok) return setError(upload.error);
        const response = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: putHeaders(upload.headers),
          body: file,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
        if (!response.ok) return setError("upload_failed");
        const complete = await completeUploadAction({ fileId: upload.fileId });
        if (!complete.ok)
          return setError(
            complete.error === "signed_out" ? "forbidden" : complete.error
          );
        const submitted = await submitSignedFormAction({
          ...target,
          fileId: upload.fileId,
          uses: selected.map(({ purpose }) => purpose),
          documentIds: Object.fromEntries(
            selected.map(({ purpose, id }) => [purpose, id])
          ),
        });
        if (!submitted.ok) return setError(submitted.error);
        form.reset();
      } catch {
        setError("upload_failed");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      aria-label={labels.accessibleName}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <label htmlFor={fieldId} className="font-semibold">
          {labels.file}
        </label>
        <p id={`${fieldId}-limits`} className="text-sm text-ink-muted">
          {labels.limits}
        </p>
        {/* The scan bytes only travel in the signed PUT. */}
        <input
          ref={scan}
          type="file"
          id={fieldId}
          required
          className={inputStyles}
          accept={PURPOSE_RULES.consent_form.contentTypes.join(",")}
          aria-describedby={`${fieldId}-limits`}
        />
      </div>
      <fieldset className="grid gap-1 border-0">
        <legend className="mb-1 font-semibold">{labels.uses}</legend>
        {offers.map(({ purpose, label, versionLabel }) => (
          <label key={purpose} className="flex min-h-11 items-start gap-3 py-2">
            <input
              className="mt-1 size-4 shrink-0 accent-link"
              type="checkbox"
              name="uses"
              value={purpose}
            />
            <span>
              {label}{" "}
              <span className="block text-sm text-ink-muted">
                {versionLabel}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {error ? (
        <FormAlert tone="danger" label={feedback.problem}>
          {feedback.errors[error]}
        </FormAlert>
      ) : null}
      <div>
        <SubmitButton pending={pending} pendingLabel={labels.uploading}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
