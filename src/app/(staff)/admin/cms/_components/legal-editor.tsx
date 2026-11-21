"use client";

import { useActionState } from "react";

import { FormAlert, inputStyles, SubmitButton } from "@/components/form";
import { cn } from "@/lib/utils";
import type { CmsDocumentKey } from "@/server/modules/cms/domain/documents";

import { saveLegalDraftAction } from "../_lib/actions";

export type LegalEditorLabels = {
  label: string;
  hint: string;
  save: string;
  saving: string;
  fixErrors: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
};

/**
 * A legal page's draft in #64's plain-text markup, prefilled from the
 * draft (or the published text). Save stores it as the draft; the page
 * then shows what it will look like. Every message comes translated from
 * the action; static words come in `labels`.
 */
export function LegalEditor({
  documentKey,
  defaultSource,
  labels,
}: {
  documentKey: CmsDocumentKey;
  defaultSource: string;
  labels: LegalEditorLabels;
}) {
  const [view, formAction] = useActionState(saveLegalDraftAction, null);
  const errors = view?.text.sourceErrors ?? [];

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="key" value={documentKey} />

      {view?.text.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.text.alert}</p>
        </FormAlert>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="cms-source" className="font-semibold text-ink">
          {labels.label}
        </label>
        <p id="cms-source-hint" className="text-sm text-ink-muted">
          {labels.hint}
        </p>
        {errors.length > 0 ? (
          <FormAlert tone="danger" label={labels.problem}>
            <p>{labels.fixErrors}</p>
            <ul id="cms-source-errors" className="list-disc pl-5">
              {errors.map((error, k) => (
                <li key={k}>{error}</li>
              ))}
            </ul>
          </FormAlert>
        ) : null}
        <textarea
          id="cms-source"
          name="source"
          required
          rows={20}
          spellCheck
          defaultValue={view?.source ?? defaultSource}
          aria-describedby={cn(
            "cms-source-hint",
            errors.length > 0 && "cms-source-errors"
          )}
          aria-invalid={errors.length > 0 ? true : undefined}
          className={cn(inputStyles, "font-mono text-sm leading-relaxed")}
        />
      </div>

      <div>
        <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}
