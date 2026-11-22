"use client";

import { CircleCheck, Clock, LoaderCircle, ShieldEllipsis } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { FormAlert, inputStyles } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

import {
  completeUploadAction,
  fileStatusAction,
  requestUploadAction,
} from "../_lib/actions";
import {
  runUpload,
  wait,
  type UploadSteps,
  type UploadView,
} from "../_lib/run-upload";
import { downloadPathFor, type MessageKey } from "../_lib/upload";

export type UploadFormLabels = {
  field: { label: string; hint: string };
  upload: string;
  uploading: string;
  status: {
    uploading: string;
    checking: string;
    ready: string;
    readyLead: string;
    slow: string;
  };
  downloadFile: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
  errors: Record<MessageKey, string>;
};

/** The browser's side of each upload step. */
const BROWSER_STEPS: UploadSteps = {
  requestUpload: requestUploadAction,
  completeUpload: completeUploadAction,
  fileStatus: fileStatusAction,
  async put(url, body, headers, signal) {
    const response = await fetch(url, { method: "PUT", headers, body, signal });
    return response.ok;
  },
  wait,
  now: () => Date.now(),
};

const STATUS_ICON = {
  uploading: LoaderCircle,
  checking: ShieldEllipsis,
  ready: CircleCheck,
  slow: Clock,
} as const;

/**
 * The file upload demo: one file at a time, uploaded straight to private
 * storage, then held until the virus check passes. Every word comes in
 * `labels`.
 */
export function UploadForm({
  labels,
  accept,
}: {
  labels: UploadFormLabels;
  /** The content types the server takes, for the file picker. */
  accept: string;
}) {
  const [view, setView] = useState<UploadView>({ step: "idle" });
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const running = useRef<AbortController | null>(null);

  // Stop polling if the page goes away mid-upload.
  useEffect(() => () => running.current?.abort(), []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) {
      setView({ step: "failed", message: "noFile" });
      return;
    }
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    startTransition(() =>
      runUpload(file, controller.signal, setView, BROWSER_STEPS)
    );
  }

  const statusLine =
    view.step === "uploading" ||
    view.step === "checking" ||
    view.step === "ready" ||
    view.step === "slow"
      ? view.step
      : null;
  const Icon = statusLine ? STATUS_ICON[statusLine] : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {view.step === "failed" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.errors[view.message]}</p>
        </FormAlert>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="file" className="font-semibold text-ink">
          {labels.field.label}
        </label>
        <p id="file-hint" className="text-sm text-ink-muted">
          {labels.field.hint}
        </p>
        <input
          ref={input}
          id="file"
          name="file"
          type="file"
          accept={accept}
          aria-describedby="file-hint"
          className={cn(
            inputStyles,
            "file:me-4 file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:py-1 file:font-semibold file:text-ink"
          )}
        />
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonStyles()}
        >
          {pending ? labels.uploading : labels.upload}
        </button>
      </div>

      {/* Always in the page (an <output> is a polite status region), so
          each step is announced as it changes. */}
      <output htmlFor="file" className="block">
        {statusLine && Icon ? (
          <span className="flex items-start gap-2 text-ink">
            <Icon
              aria-hidden="true"
              className={cn(
                "mt-0.5 size-5 shrink-0",
                statusLine === "uploading" && "motion-safe:animate-spin"
              )}
            />
            {statusLine === "ready" ? (
              <span>
                <strong>{labels.status.ready}</strong> {labels.status.readyLead}
              </span>
            ) : (
              <span>{labels.status[statusLine]}</span>
            )}
          </span>
        ) : null}
      </output>

      {view.step === "ready" ? (
        <p>
          {/* A plain link: the route checks access, then redirects to a
              short-lived signed URL, so it must never be prefetched. */}
          <a
            href={downloadPathFor(view.fileId)}
            className={buttonStyles({ variant: "secondary" })}
          >
            {labels.downloadFile}
          </a>
        </p>
      ) : null}
    </form>
  );
}
