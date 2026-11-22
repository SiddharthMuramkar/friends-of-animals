"use client";

import { CircleCheck, Clock, LoaderCircle, ShieldEllipsis } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  runUpload,
  wait,
  type UploadSteps,
  type UploadView,
} from "@/app/account/files/_lib/run-upload";
import type { MessageKey } from "@/app/account/files/_lib/upload";
import { FormAlert, inputStyles } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

import {
  completePostImageUploadAction,
  postImageStatusAction,
  requestPostImageUploadAction,
} from "../_lib/actions";

export type ImageUploadLabels = {
  label: string;
  hint: string;
  submit: string;
  uploading: string;
  checking: string;
  ready: string;
  slow: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
  errors: Record<MessageKey, string>;
};

const STATUS_ICON = {
  uploading: LoaderCircle,
  checking: ShieldEllipsis,
  ready: CircleCheck,
  slow: Clock,
} as const;

/**
 * Uploads one image for the post, straight to private storage, as the
 * Files module's upload demo does (the same flow, run-upload.ts). Once the
 * scan passes, worker-media makes its resized copies; the page shows the
 * image as ready after a reload. Every word comes in `labels`.
 */
export function ImageUpload({
  postId,
  labels,
}: {
  postId: string;
  labels: ImageUploadLabels;
}) {
  const [view, setView] = useState<UploadView>({ step: "idle" });
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const running = useRef<AbortController | null>(null);

  // Stop polling if the page goes away mid-upload.
  useEffect(() => () => running.current?.abort(), []);

  const steps: UploadSteps = {
    requestUpload: (request) => requestPostImageUploadAction(postId, request),
    completeUpload: completePostImageUploadAction,
    fileStatus: postImageStatusAction,
    async put(url, body, headers, signal) {
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body,
        signal,
      });
      return response.ok;
    },
    wait,
    now: () => Date.now(),
  };

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
    startTransition(() => runUpload(file, controller.signal, setView, steps));
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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {view.step === "failed" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.errors[view.message]}</p>
        </FormAlert>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="post-image" className="font-semibold text-ink">
          {labels.label}
        </label>
        <p id="post-image-hint" className="text-sm text-ink-muted">
          {labels.hint}
        </p>
        <input
          ref={input}
          id="post-image"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="post-image-hint"
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
          className={buttonStyles({ variant: "secondary" })}
        >
          {pending ? labels.uploading : labels.submit}
        </button>
      </div>
      {/* Always in the page (an <output> is a polite status region), so
          each step is announced as it changes. */}
      <output htmlFor="post-image" className="block">
        {statusLine && Icon ? (
          <span className="flex items-start gap-2 text-ink">
            <Icon
              aria-hidden="true"
              className={cn(
                "mt-0.5 size-5 shrink-0",
                statusLine === "uploading" && "motion-safe:animate-spin"
              )}
            />
            <span>
              {statusLine === "uploading"
                ? labels.uploading
                : labels[statusLine]}
            </span>
          </span>
        ) : null}
      </output>
    </form>
  );
}
