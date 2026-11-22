"use client";

import { useActionState } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { cn } from "@/lib/utils";

import type { PostFormState, PostFormValues } from "../_lib/post-form";

export type PostFormLabels = {
  kind: string;
  title: string;
  slug: string;
  slugHint: string;
  excerpt: string;
  excerptHint: string;
  seoTitle: string;
  seoTitleHint: string;
  easyRead: string;
  easyReadHint: string;
  authorName: string;
  authorNameHint: string;
  audience: string;
  topics: string;
  topicsHint: string;
  featured: string;
  cover: string;
  coverHint: string;
  source: string;
  sourceHint: string;
  submit: string;
  pending: string;
  fixErrors: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  /** Each field refusal code's words. */
  errors: Record<string, string>;
  /** Each whole-form alert's words. */
  alerts: Record<string, string>;
  /** The markup's error messages, by code, and "Line {line}: {message}". */
  sourceErrors: Record<string, string>;
  lineError: string;
};

type Option = { value: string; label: string };

/**
 * A post's fields and its text in the post markup. Saving sends it to
 * `action`, which redirects to the editor once saved; a refused save comes
 * back with each field's problem. Every word comes in `labels`.
 */
export function PostForm({
  action,
  initial,
  labels,
  kinds,
  audiences,
  covers,
}: {
  action: (
    previous: PostFormState | null,
    formData: FormData
  ) => Promise<PostFormState>;
  initial: PostFormValues;
  labels: PostFormLabels;
  kinds: Option[];
  audiences: Option[];
  covers: Option[];
}) {
  const [state, formAction] = useActionState(action, null);
  const values = state?.values ?? initial;
  const errors = state?.errors ?? {};
  const sourceErrors = state?.sourceErrors ?? [];
  const error = (name: keyof PostFormValues | "coverAlt") => {
    const code = errors[name];
    return code ? (labels.errors[code] ?? labels.errors.invalid) : undefined;
  };
  const sourceMessages = sourceErrors.map(({ line, code }) => {
    const message = labels.sourceErrors[code] ?? code;
    return line === null
      ? message
      : labels.lineError
          .replace("{line}", String(line))
          .replace("{message}", message);
  });
  const hasErrors = Object.keys(errors).length > 0 || sourceErrors.length > 0;

  return (
    <form
      // A refused save comes back with the values as typed: start again
      // from them.
      key={state?.attempt ?? 0}
      action={formAction}
      noValidate
      className="flex flex-col gap-6"
    >
      {state?.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : hasErrors ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.fixErrors}</p>
        </FormAlert>
      ) : null}

      <Select
        id="post-kind"
        name="kind"
        label={labels.kind}
        options={kinds}
        defaultValue={values.kind}
        error={error("kind")}
      />
      <TextField
        id="post-title"
        name="title"
        label={labels.title}
        defaultValue={values.title}
        error={error("title")}
        required
      />
      <TextField
        id="post-slug"
        name="slug"
        label={labels.slug}
        hint={labels.slugHint}
        defaultValue={values.slug}
        error={error("slug")}
        autoCapitalize="none"
        spellCheck={false}
      />
      <TextArea
        id="post-excerpt"
        name="excerpt"
        label={labels.excerpt}
        hint={labels.excerptHint}
        defaultValue={values.excerpt}
        error={error("excerpt")}
        rows={3}
      />
      <TextField
        id="post-seo-title"
        name="seoTitle"
        label={labels.seoTitle}
        hint={labels.seoTitleHint}
        defaultValue={values.seoTitle}
        error={error("seoTitle")}
      />
      <TextArea
        id="post-easy-read"
        name="easyRead"
        label={labels.easyRead}
        hint={labels.easyReadHint}
        defaultValue={values.easyRead}
        error={error("easyRead")}
        rows={2}
      />
      <TextField
        id="post-author"
        name="authorName"
        label={labels.authorName}
        hint={labels.authorNameHint}
        defaultValue={values.authorName}
        error={error("authorName")}
      />
      <Select
        id="post-audience"
        name="audience"
        label={labels.audience}
        options={audiences}
        defaultValue={values.audience}
        error={error("audience")}
      />
      <TextField
        id="post-topics"
        name="topics"
        label={labels.topics}
        hint={labels.topicsHint}
        defaultValue={values.topics}
        error={error("topics")}
        autoCapitalize="none"
      />
      <div className="flex items-center gap-3">
        <input
          id="post-featured"
          name="featured"
          type="checkbox"
          defaultChecked={values.featured}
          className="size-5 shrink-0 accent-primary"
        />
        <label htmlFor="post-featured" className="font-semibold text-ink">
          {labels.featured}
        </label>
      </div>
      <Select
        id="post-cover"
        name="cover"
        label={labels.cover}
        hint={labels.coverHint}
        options={covers}
        defaultValue={values.cover}
        error={error("cover") ?? error("coverAlt")}
      />

      <div className="flex flex-col gap-2">
        <label htmlFor="post-source" className="font-semibold text-ink">
          {labels.source}
        </label>
        <p id="post-source-hint" className="text-sm text-ink-muted">
          {labels.sourceHint}
        </p>
        {sourceMessages.length > 0 ? (
          <ul
            id="post-source-errors"
            className="list-disc pl-5 font-semibold text-danger"
          >
            {sourceMessages.map((message, k) => (
              <li key={k}>{message}</li>
            ))}
          </ul>
        ) : null}
        <textarea
          id="post-source"
          name="source"
          rows={18}
          spellCheck
          defaultValue={values.source}
          aria-describedby={cn(
            "post-source-hint",
            sourceMessages.length > 0 && "post-source-errors"
          )}
          aria-invalid={sourceMessages.length > 0 ? true : undefined}
          className={cn(inputStyles, "font-mono text-sm leading-relaxed")}
        />
      </div>

      <div>
        <SubmitButton pendingLabel={labels.pending}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}

/** A labelled select, wired like TextField. */
function Select({
  id,
  name,
  label,
  hint,
  error,
  options,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  options: Option[];
  defaultValue: string;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={inputStyles}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A labelled textarea, wired like TextField. */
function TextArea({
  id,
  name,
  label,
  hint,
  error,
  defaultValue,
  rows,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  defaultValue: string;
  rows: number;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={inputStyles}
      />
    </div>
  );
}
