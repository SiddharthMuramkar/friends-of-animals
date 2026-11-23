"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { completeUploadAction } from "@/app/account/files/_lib/actions";
import { putHeaders } from "@/app/account/files/_lib/upload";
import { FormAlert, SubmitButton } from "@/components/form";
import { inputStyles } from "@/components/form/text-field";
import type { SignedFormsForRegistration } from "@/server/modules/consent-forms/dashboard";
import { PURPOSE_RULES } from "@/server/modules/files/domain/purposes";
import type { Messages } from "@/i18n/messages";

import {
  requestSignedFormUploadAction,
  submitSignedFormAction,
} from "../signed-form-actions";

type UploadError = keyof Messages["adminConsentForms"]["errors"];

export function SignedFormUpload({
  registrationId,
  studentId,
  studentName,
  offers,
}: {
  registrationId: string;
  studentId: string;
  studentName: string;
  offers: SignedFormsForRegistration["offers"];
}) {
  const t = useTranslations("adminConsentForms");
  const callout = useTranslations("common.callout");
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
        const target = { registrationId, studentId };
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
      aria-label={t("coordinator.uploadFor", { student: studentName })}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <label htmlFor={fieldId} className="font-semibold">
          {t("coordinator.file")}
        </label>
        <p id={`${fieldId}-limits`} className="text-sm text-ink-muted">
          {t("coordinator.limits")}
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
        <legend className="mb-1 font-semibold">{t("coordinator.uses")}</legend>
        {offers.map(({ purpose, version, title }) => (
          <label key={purpose} className="flex min-h-11 items-start gap-3 py-2">
            <input
              className="mt-1 size-4 shrink-0 accent-link"
              type="checkbox"
              name="uses"
              value={purpose}
            />
            <span>
              {t(`purposes.${purpose}`)}{" "}
              <span className="block text-sm text-ink-muted">
                {t("version", { version, title })}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {error ? (
        <FormAlert tone="danger" label={callout("danger")}>
          {t(`errors.${error}`)}
        </FormAlert>
      ) : null}
      <div>
        <SubmitButton
          pending={pending}
          pendingLabel={t("coordinator.uploading")}
        >
          {t("coordinator.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}
