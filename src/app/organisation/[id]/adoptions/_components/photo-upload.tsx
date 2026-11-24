"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { completeUploadAction } from "@/app/account/files/_lib/actions";
import { putHeaders } from "@/app/account/files/_lib/upload";
import { FormAlert, SubmitButton } from "@/components/form";
import { inputStyles } from "@/components/form/text-field";
import { PURPOSE_RULES } from "@/server/modules/files/domain/purposes";

import {
  refreshAnimalAction,
  requestAdoptionPhotoUploadAction,
} from "../_lib/actions";
import {
  PHOTO_UPLOAD_ERRORS,
  type PhotoUploadError,
} from "../_lib/photo-upload-errors";

export type PhotoUploadLabels = {
  file: string;
  limits: string;
  alt: string;
  altHint: string;
  submit: string;
  uploading: string;
  uploaded: string;
  errors: Record<PhotoUploadError, string>;
  problem: string;
  done: string;
};

function knownError(error: string): PhotoUploadError {
  return (PHOTO_UPLOAD_ERRORS as readonly string[]).includes(error)
    ? (error as PhotoUploadError)
    : "unexpected";
}

/**
 * Adds one photo of an animal: presign, PUT straight to storage, complete.
 * The bytes never pass through the app's server; the scan and resizing
 * follow in the background.
 */
export function PhotoUpload({
  adoptionListingId,
  labels,
}: {
  adoptionListingId: string;
  labels: PhotoUploadLabels;
}) {
  const fieldId = useId();
  const file = useRef<HTMLInputElement>(null);
  const [pending, startUpload] = useTransition();
  const [error, setError] = useState<PhotoUploadError | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const chosen = file.current?.files?.[0];
    const altText = new FormData(form).get("altText");
    if (!chosen || chosen.size === 0) return setError("empty");
    setError(null);
    setDone(false);
    startUpload(async () => {
      try {
        const upload = await requestAdoptionPhotoUploadAction({
          adoptionListingId,
          altText: typeof altText === "string" ? altText : "",
          contentType: chosen.type,
          sizeBytes: chosen.size,
        });
        if (!upload.ok) return setError(knownError(upload.error));
        const response = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: putHeaders(upload.headers),
          body: chosen,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
        if (!response.ok) return setError("upload_failed");
        const complete = await completeUploadAction(upload.fileId);
        if (!complete.ok) return setError("upload_failed");
        form.reset();
        setDone(true);
        await refreshAnimalAction();
      } catch {
        setError("upload_failed");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      aria-label={labels.submit}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <label htmlFor={fieldId} className="font-semibold">
          {labels.file}
        </label>
        <p id={`${fieldId}-limits`} className="text-sm text-ink-muted">
          {labels.limits}
        </p>
        {/* The bytes only travel in the signed PUT. */}
        <input
          ref={file}
          type="file"
          id={fieldId}
          required
          className={inputStyles}
          accept={PURPOSE_RULES.adoption_photo.contentTypes.join(",")}
          aria-describedby={`${fieldId}-limits`}
        />
      </div>
      <div className="grid gap-2">
        <label htmlFor={`${fieldId}-alt`} className="font-semibold">
          {labels.alt}
        </label>
        <p id={`${fieldId}-alt-hint`} className="text-sm text-ink-muted">
          {labels.altHint}
        </p>
        <input
          id={`${fieldId}-alt`}
          name="altText"
          required
          maxLength={150}
          className={inputStyles}
          aria-describedby={`${fieldId}-alt-hint`}
        />
      </div>
      {error ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.errors[error]}</p>
        </FormAlert>
      ) : null}
      {done && !error ? (
        <FormAlert tone="success" label={labels.done}>
          <p>{labels.uploaded}</p>
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
