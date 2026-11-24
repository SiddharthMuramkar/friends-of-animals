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
import { ENTRY_TEXT_LIMITS } from "@/server/modules/entries/domain/entry-text";
import {
  acceptAttribute,
  checkUpload,
  type UploadRule,
} from "@/server/modules/entries/domain/upload-rules";
import type { ImageDiscipline } from "@/server/modules/entries/rules";

import {
  completeEntryUploadAction,
  startEntryUploadAction,
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

type UploadLabels = {
  form: Record<UploadMode, string> & {
    details: string;
    discipline: string;
    chooseDiscipline: string;
    title: string;
    titleRequired: string;
    description: string;
    descriptionRequired: string;
    statement: string;
    file: string;
    previewAlt: string;
    busy: string;
    problem: string;
  };
  errors: Record<EntryUploadError, string>;
};

type DisciplineOption = {
  value: ImageDiscipline;
  label: string;
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

export function EntryUploadForm({
  registrationId,
  options,
  mode,
  text,
  labels: { form: copy, errors },
}: {
  registrationId: string;
  options: readonly DisciplineOption[];
  mode: UploadMode;
  text?: EntryText;
  labels: UploadLabels;
}) {
  const first = options[0]!;
  const [discipline, setDiscipline] = useState<ImageDiscipline | "">(
    options.length === 1 ? first.value : ""
  );
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<keyof typeof errors>();
  const [requiredField, setRequiredField] = useState<"title" | "description">();
  const [busy, setBusy] = useState(false);
  const upload = useRef<UploadMemory>({ attempt: null });
  const { rule, hint } =
    options.find((option) => option.value === discipline) ?? first;
  const validation = file && checkUpload(file, rule);
  const fileError =
    validation && !validation.ok ? errors[validation.reason] : null;
  const preview =
    validation?.ok &&
    (validation.contentType === "image/jpeg" ||
      validation.contentType === "image/png" ||
      validation.contentType === "image/webp");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !discipline) return;
    if (!file || !validation?.ok) {
      const input = event.currentTarget.elements.namedItem("image");
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    const data = new FormData(event.currentTarget);
    const fieldText = (name: keyof EntryText) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const title = fieldText("title");
    const description = fieldText("description");
    setError(undefined);
    if (!title || !description) {
      const field = !title ? "title" : "description";
      setRequiredField(field);
      const input = event.currentTarget.elements.namedItem(field);
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    setRequiredField(undefined);
    setBusy(true);
    try {
      const outcome = await runEntryUpload(
        upload.current,
        {
          registrationId,
          discipline,
          file,
          title,
          description,
          statement: fieldText("statement"),
        },
        STEPS
      );
      if (outcome.ok) {
        window.location.assign(entryDetailPath(outcome.entryCode));
      } else {
        setError(outcome.error);
      }
    } finally {
      setBusy(false);
    }
  }

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
        <TextAreaField
          id="entry-statement"
          name="statement"
          label={copy.statement}
          defaultValue={text?.statement ?? undefined}
          maxLength={ENTRY_TEXT_LIMITS.statement}
          rows={4}
        />
        <TextField
          id="entry-image"
          name="image"
          type="file"
          label={copy.file}
          hint={hint}
          error={fileError ?? undefined}
          accept={acceptAttribute(rule)}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0]);
            setError(undefined);
          }}
          required
        />
        {file && preview ? (
          <ImagePreview file={file} alt={copy.previewAlt} />
        ) : null}
        {error ? (
          <FormAlert tone="danger" label={copy.problem}>
            {errors[error]}
          </FormAlert>
        ) : null}
        <div>
          <button type="submit" className={buttonStyles()}>
            {busy ? copy.busy : copy[mode]}
          </button>
        </div>
      </fieldset>
      <output className="sr-only">
        {fileError ?? (busy ? copy.busy : "")}
      </output>
    </form>
  );
}
