"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { completeUploadAction } from "@/app/account/files/_lib/actions";
import { putHeaders } from "@/app/account/files/_lib/upload";
import { FormAlert, SubmitButton } from "@/components/form";
import { inputStyles } from "@/components/form/text-field";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
} from "@/server/modules/directory/domain/documents";
import { PURPOSE_RULES } from "@/server/modules/files/domain/purposes";

import {
  refreshListingAction,
  requestListingDocumentUploadAction,
} from "../../_lib/actions";

export type DocumentUploadError =
  | "empty"
  | "invalid_input"
  | "type_not_allowed"
  | "too_large"
  | "purpose_unavailable"
  | "listing_not_editable"
  | "too_many_documents"
  | "upload_failed"
  | "forbidden"
  | "not_found"
  | "upload_missing"
  | "size_mismatch"
  | "type_mismatch"
  | "upload_expired"
  | "unexpected";

export type DocumentUploadLabels = {
  kind: string;
  kinds: Record<DocumentKind, string>;
  file: string;
  limits: string;
  submit: string;
  uploading: string;
  uploaded: string;
  errors: Record<DocumentUploadError, string>;
  problem: string;
  done: string;
};

function knownError(error: string): DocumentUploadError {
  const known: readonly string[] = [
    "invalid_input",
    "type_not_allowed",
    "too_large",
    "purpose_unavailable",
    "listing_not_editable",
    "too_many_documents",
    "forbidden",
    "not_found",
    "upload_missing",
    "size_mismatch",
    "type_mismatch",
    "upload_expired",
  ];
  return known.includes(error) ? (error as DocumentUploadError) : "unexpected";
}

/**
 * Sends one document for FOA's verification: presign, PUT straight to
 * storage, complete. The bytes never pass through the app's server.
 */
export function DocumentUpload({
  listingId,
  labels,
}: {
  listingId: string;
  labels: DocumentUploadLabels;
}) {
  const fieldId = useId();
  const file = useRef<HTMLInputElement>(null);
  const [pending, startUpload] = useTransition();
  const [error, setError] = useState<DocumentUploadError | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const chosen = file.current?.files?.[0];
    const kind = new FormData(form).get("kind");
    if (!chosen || chosen.size === 0) return setError("empty");
    setError(null);
    setDone(false);
    startUpload(async () => {
      try {
        const upload = await requestListingDocumentUploadAction({
          listingId,
          kind: typeof kind === "string" ? kind : "",
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
        if (!complete.ok) {
          return setError(
            complete.error === "signed_out"
              ? "forbidden"
              : knownError(complete.error)
          );
        }
        form.reset();
        setDone(true);
        await refreshListingAction();
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
        <label htmlFor={`${fieldId}-kind`} className="font-semibold">
          {labels.kind}
        </label>
        <select
          id={`${fieldId}-kind`}
          name="kind"
          defaultValue={DOCUMENT_KINDS[0]}
          className={inputStyles}
        >
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {labels.kinds[kind]}
            </option>
          ))}
        </select>
      </div>
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
          accept={PURPOSE_RULES.directory_document.contentTypes.join(",")}
          aria-describedby={`${fieldId}-limits`}
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
