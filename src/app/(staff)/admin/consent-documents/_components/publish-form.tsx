"use client";

import { useActionState } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import type { LegalFact } from "@/content/legal";
import { cn } from "@/lib/utils";
import type { ConsentPurpose } from "@/server/consent";

import { publishFormAction } from "../_lib/actions";
import { BodyPreview } from "./body-preview";

export type PublishFormLabels = {
  title: string;
  source: { label: string; hint: string };
  preview: string;
  previewing: string;
  /** "Publish version N", for the next version. */
  publish: string;
  publishing: string;
  previewTitle: string;
  fixErrors: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
};

/**
 * Publish the next version of one consent document: a title and the text
 * in the staff markup, prefilled from the current version. Preview shows
 * the result (or what to fix) without saving; Publish saves it. Every
 * message comes translated from the action; static words come in `labels`.
 */
export function PublishForm({
  purpose,
  defaults,
  labels,
  factLabels,
}: {
  purpose: ConsentPurpose;
  defaults: { title: string; source: string };
  labels: PublishFormLabels;
  factLabels: Record<LegalFact, string>;
}) {
  const [view, formAction] = useActionState(publishFormAction, null);
  const id = (name: string) => `${purpose}-${name}`;
  const errors = view?.text.sourceErrors ?? [];

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="purpose" value={purpose} />

      {view?.text.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.text.alert}</p>
        </FormAlert>
      ) : null}

      <TextField
        id={id("title")}
        name="title"
        required
        maxLength={200}
        defaultValue={view?.title ?? defaults.title}
        label={labels.title}
        error={view?.text.title}
      />

      <div className="flex flex-col gap-2">
        <label htmlFor={id("source")} className="font-semibold text-ink">
          {labels.source.label}
        </label>
        <p id={id("source-hint")} className="text-sm text-ink-muted">
          {labels.source.hint}
        </p>
        {errors.length > 0 ? (
          <FormAlert tone="danger" label={labels.problem}>
            <p>{labels.fixErrors}</p>
            <ul id={id("source-errors")} className="list-disc pl-5">
              {errors.map((error, k) => (
                <li key={k}>{error}</li>
              ))}
            </ul>
          </FormAlert>
        ) : null}
        <textarea
          id={id("source")}
          name="source"
          required
          rows={16}
          spellCheck
          defaultValue={view?.source ?? defaults.source}
          aria-describedby={cn(
            id("source-hint"),
            errors.length > 0 && id("source-errors")
          )}
          aria-invalid={errors.length > 0 ? true : undefined}
          className={cn(inputStyles, "font-mono text-sm leading-relaxed")}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <SubmitButton
          name="intent"
          value="preview"
          variant="secondary"
          pendingLabel={labels.previewing}
        >
          {labels.preview}
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="publish"
          pendingLabel={labels.publishing}
        >
          {labels.publish}
        </SubmitButton>
      </div>

      {view?.preview ? (
        <section
          aria-labelledby={id("preview")}
          className="rounded-3xl border-2 border-dashed border-border-strong bg-surface-muted p-5 sm:p-6"
        >
          <h3 id={id("preview")} className="text-lead font-bold text-ink">
            {labels.previewTitle}
          </h3>
          <div className="mt-4">
            <BodyPreview body={view.preview} factLabels={factLabels} />
          </div>
        </section>
      ) : null}
    </form>
  );
}
