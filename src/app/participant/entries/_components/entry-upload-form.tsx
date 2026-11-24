"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  FormAlert,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { entryDetailPath } from "@/lib/app-routes";
import type { Discipline } from "@/server/modules/competitions/domain/vocabulary";
import { ENTRY_TEXT_LIMITS } from "@/server/modules/entries/domain/entry-text";
import {
  checkEssayText,
  countWords,
  DEFAULT_ESSAY_RULE,
  normaliseEssayText,
} from "@/server/modules/entries/domain/essay-text";
import {
  acceptAttribute,
  checkUpload,
  type UploadKind,
  type UploadRule,
} from "@/server/modules/entries/domain/upload-rules";
import type { EntryFormat } from "@/server/modules/entries/rules";

import {
  completeEntryUploadAction,
  startEntryUploadAction,
  submitEssayTextAction,
} from "../_lib/actions";
import {
  runEntryUpload,
  type EntryUploadError,
  type EntryUploadSteps,
  type UploadMemory,
} from "../_lib/upload-flow";

type UploadMode = "submit" | "replace" | "retry";

/** The browser's side of the upload: the actions and a PUT with fetch. */
const STEPS: EntryUploadSteps = {
  start: (input) => startEntryUploadAction(input),
  complete: (input) => completeEntryUploadAction(input),
  put: async (url, body, headers) => {
    const response = await fetch(url, { method: "PUT", headers, body });
    return response.ok;
  },
};

/** Every error the form can show: an upload's, and a typed essay's (#86). */
export type FormError = EntryUploadError | "too_many_words";

/** The words for one kind of file: its field, buttons and progress. */
type KindLabels = Record<UploadMode, string> & { file: string; busy: string };

export type UploadLabels = {
  form: {
    details: string;
    discipline: string;
    chooseDiscipline: string;
    title: string;
    titleRequired: string;
    description: string;
    descriptionRequired: string;
    statement: string;
    previewAlt: string;
    problem: string;
    /** Said while the browser reads a video's length. */
    measuring: string;
  };
  kinds: Record<UploadKind, KindLabels>;
  essay: Record<UploadMode, string> & {
    method: string;
    typed: string;
    document: string;
    text: string;
    textHint: string;
    textRequired: string;
    /** "{count} of 1,500 words", with {count} filled in as you type. */
    count: string;
    busy: string;
  };
  /** Every error, worded for each kind of file. */
  errors: Record<UploadKind, Record<FormError, string>>;
};

export type DisciplineOption = {
  value: Discipline;
  label: string;
  format: EntryFormat;
  rule: UploadRule;
  hint: string;
};

type EntryText = {
  title: string;
  description: string;
  statement: string | null;
};

function ImagePreview({ file, alt }: { file: File; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = ref.current;
    if (!image) return;
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    return () => {
      image.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  return (
    // oxlint-disable-next-line nextjs/no-img-element -- This object URL exists only in the browser.
    <img
      ref={ref}
      alt={alt}
      className="max-h-48 max-w-full rounded-xl object-contain"
    />
  );
}

/**
 * A video's length as this browser can read it, in milliseconds, or null
 * when it can't (Chrome and Firefox can't decode HEVC, a phone's usual
 * codec): the server and worker-media decide then.
 */
function readVideoLength(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const done = (length: number | null) => {
      video.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
      resolve(length);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      done(
        Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : null
      );
    video.onerror = () => done(null);
    video.src = objectUrl;
  });
}

const TYPED_ERRORS: ReadonlySet<FormError> = new Set([
  "too_many_words",
  "too_long",
]);

export function EntryUploadForm({
  registrationId,
  options,
  mode,
  text,
  essay: typedBefore,
  labels: { form: copy, kinds, essay: essayCopy, errors: errorsByKind },
}: {
  registrationId: string;
  options: readonly DisciplineOption[];
  mode: UploadMode;
  text?: EntryText;
  /** The live typed essay, which a replacement starts from (#86). */
  essay?: string;
  labels: UploadLabels;
}) {
  const first = options[0]!;
  const [discipline, setDiscipline] = useState<Discipline | "">(
    options.length === 1 ? first.value : ""
  );
  const [file, setFile] = useState<File>();
  /** undefined while the browser reads it; null if it can't. */
  const [durationMs, setDurationMs] = useState<number | null>();
  const [method, setMethod] = useState<"typed" | "document">(
    mode === "submit" || typedBefore !== undefined ? "typed" : "document"
  );
  const [essayText, setEssayText] = useState(typedBefore ?? "");
  const [error, setError] = useState<FormError>();
  const [requiredField, setRequiredField] = useState<
    "title" | "description" | "essay"
  >();
  const [busy, setBusy] = useState(false);
  const upload = useRef<UploadMemory>({ attempt: null });
  const measuring = useRef<Promise<number | null> | null>(null);
  const { rule, hint, format } =
    options.find((option) => option.value === discipline) ?? first;
  const typing = format === "essay" && method === "typed";
  const errors = errorsByKind[rule.kind];
  const kind = kinds[rule.kind];
  const validation =
    file && !typing
      ? checkUpload(
          { name: file.name, type: file.type, size: file.size, durationMs },
          rule
        )
      : undefined;
  const fileError =
    validation && !validation.ok ? errors[validation.reason] : null;
  const preview =
    validation?.ok &&
    (validation.contentType === "image/jpeg" ||
      validation.contentType === "image/png" ||
      validation.contentType === "image/webp");
  const words = countWords(normaliseEssayText(essayText));
  const overWords = words > DEFAULT_ESSAY_RULE.maxWords;
  const typedError =
    typing && error && TYPED_ERRORS.has(error) ? errors[error] : undefined;

  function chooseFile(chosen: File | undefined, chosenRule = rule) {
    setFile(chosen);
    setError(undefined);
    setDurationMs(undefined);
    measuring.current = null;
    if (chosen && chosenRule.kind === "video") {
      const reading = readVideoLength(chosen);
      measuring.current = reading;
      void reading.then((length) => {
        if (measuring.current === reading) setDurationMs(length);
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !discipline) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const fieldText = (name: keyof EntryText) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const focus = (name: string) => {
      const input = form.elements.namedItem(name);
      if (input instanceof HTMLElement) input.focus();
    };
    if (!typing && (!file || (validation && !validation.ok))) {
      focus("entry-file");
      return;
    }
    const title = fieldText("title");
    const description = fieldText("description");
    setError(undefined);
    if (!title || !description) {
      const field = !title ? "title" : "description";
      setRequiredField(field);
      focus(field);
      return;
    }
    if (typing) {
      const checked = checkEssayText(essayText, DEFAULT_ESSAY_RULE);
      if (!checked.ok) {
        if (checked.reason === "empty") setRequiredField("essay");
        else setError(checked.reason);
        focus("essay");
        return;
      }
    }
    setRequiredField(undefined);
    setBusy(true);
    try {
      const statement = format === "essay" ? "" : fieldText("statement");
      const outcome = typing
        ? await submitEssayTextAction({
            registrationId,
            discipline,
            title,
            description,
            statement,
            essay: essayText,
          }).catch(() => ({ ok: false, error: "unknown" }) as const)
        : await runEntryUpload(
            upload.current,
            {
              registrationId,
              discipline,
              file: file!,
              ...(rule.kind === "video"
                ? { durationMs: await (measuring.current ?? null) }
                : {}),
              title,
              description,
              statement,
            },
            STEPS
          );
      if (outcome.ok) {
        window.location.assign(entryDetailPath(outcome.entryCode));
      } else {
        setError(outcome.error);
        if (typing && TYPED_ERRORS.has(outcome.error)) focus("essay");
      }
    } finally {
      setBusy(false);
    }
  }

  const busyLabel = typing ? essayCopy.busy : kind.busy;
  const status =
    fileError ??
    (busy
      ? busyLabel
      : rule.kind === "video" && file && durationMs === undefined
        ? copy.measuring
        : "");

  return (
    <form
      method="post"
      onSubmit={submit}
      className="mt-6 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
    >
      <fieldset disabled={busy} className="flex flex-col gap-5">
        <legend className="sr-only">{copy.details}</legend>
        {options.length > 1 ? (
          <SelectField
            id="entry-discipline"
            name="discipline"
            label={copy.discipline}
            placeholder={copy.chooseDiscipline}
            options={options.map(({ value, label }) => ({ value, label }))}
            value={discipline}
            onChange={(event) => {
              const selected = options.find(
                (option) => option.value === event.target.value
              );
              setDiscipline(selected?.value ?? "");
              chooseFile(undefined, selected?.rule);
            }}
            required
          />
        ) : (
          <p className="text-ink-muted">
            <strong className="text-ink">{copy.discipline}</strong>{" "}
            {first.label}
          </p>
        )}
        <TextField
          id="entry-title"
          name="title"
          label={copy.title}
          error={requiredField === "title" ? copy.titleRequired : undefined}
          onChange={(event) => {
            if (requiredField === "title" && event.target.value.trim())
              setRequiredField(undefined);
          }}
          defaultValue={text?.title}
          maxLength={ENTRY_TEXT_LIMITS.title}
          required
        />
        <TextAreaField
          id="entry-description"
          name="description"
          label={copy.description}
          error={
            requiredField === "description"
              ? copy.descriptionRequired
              : undefined
          }
          onChange={(event) => {
            if (requiredField === "description" && event.target.value.trim())
              setRequiredField(undefined);
          }}
          defaultValue={text?.description}
          maxLength={ENTRY_TEXT_LIMITS.description}
          rows={3}
          required
        />
        {format === "essay" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-semibold text-ink">
              {essayCopy.method}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["typed", "document"] as const).map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 has-checked:border-link"
                >
                  <input
                    type="radio"
                    name="essay-method"
                    value={value}
                    checked={method === value}
                    onChange={() => {
                      setMethod(value);
                      setError(undefined);
                    }}
                    className="size-5 shrink-0 accent-link"
                  />
                  <span>{essayCopy[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <TextAreaField
            id="entry-statement"
            name="statement"
            label={copy.statement}
            defaultValue={text?.statement ?? undefined}
            maxLength={ENTRY_TEXT_LIMITS.statement}
            rows={4}
          />
        )}
        {typing ? (
          <div className="flex flex-col gap-2">
            <TextAreaField
              id="entry-essay"
              name="essay"
              label={essayCopy.text}
              hint={essayCopy.textHint}
              error={
                requiredField === "essay" ? essayCopy.textRequired : typedError
              }
              value={essayText}
              onChange={(event) => {
                setEssayText(event.target.value);
                if (requiredField === "essay") setRequiredField(undefined);
                if (typedError) setError(undefined);
              }}
              maxLength={DEFAULT_ESSAY_RULE.maxChars}
              rows={14}
              required
            />
            <p
              aria-live="polite"
              className={
                overWords
                  ? "text-sm font-semibold text-danger"
                  : "text-sm text-ink-muted"
              }
            >
              {essayCopy.count.replace("{count}", String(words))}
            </p>
          </div>
        ) : (
          <TextField
            id="entry-file"
            name="entry-file"
            type="file"
            label={kind.file}
            hint={hint}
            error={fileError ?? undefined}
            accept={acceptAttribute(rule)}
            onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
            required
          />
        )}
        {file && preview && !typing ? (
          <ImagePreview file={file} alt={copy.previewAlt} />
        ) : null}
        {error && !typedError ? (
          <FormAlert tone="danger" label={copy.problem}>
            {errors[error]}
          </FormAlert>
        ) : null}
        <div>
          <button type="submit" className={buttonStyles()}>
            {busy ? busyLabel : typing ? essayCopy[mode] : kind[mode]}
          </button>
        </div>
      </fieldset>
      <output className="sr-only">{status}</output>
    </form>
  );
}
