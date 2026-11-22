"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { cn } from "@/lib/utils";

import { saveRubricAction } from "../_lib/actions";
import type { RubricEditorView } from "../_lib/editor-view";

export type RubricEditorLabels = {
  /** "Criterion 1" … one per row the editor can show. */
  rowTitles: string[];
  newRowTitle: string;
  label: string;
  description: string;
  descriptionHint: string;
  weight: string;
  minScore: string;
  maxScore: string;
  remove: string;
  newRowsHint: string;
  save: string;
  saving: string;
  publish: string;
  publishing: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const ROW =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/**
 * A draft's criteria as rows of fields, with "Save draft" and "Save and
 * publish". A refusal shows here, each field at fault marked and what was
 * typed kept; a change that worked reloads the page with a notice.
 */
export function RubricEditor({
  competitionId,
  discipline,
  rubricId,
  initial,
  labels,
}: {
  competitionId: string;
  discipline: string;
  rubricId: string;
  initial: RubricEditorView;
  labels: RubricEditorLabels;
}) {
  const [view, formAction] = useActionState(saveRubricAction, initial);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="discipline" value={discipline} />
      <input type="hidden" name="rubricId" value={rubricId} />
      <input type="hidden" name="rows" value={view.rows.length} />
      {view.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.alert}</p>
          {view.details?.length ? (
            <ul className="mt-2 list-disc pl-5">
              {view.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </FormAlert>
      ) : null}
      {view.rows.some((row) => row.blank) ? (
        <p className="text-ink-muted">{labels.newRowsHint}</p>
      ) : null}
      {view.rows.map((row, index) => {
        const id = `criterion-${index}`;
        const name = (field: string) => `criteria.${index}.${field}`;
        const descriptionError = row.errors.description;
        return (
          <fieldset key={`${id}-${row.values.label}`} className={ROW}>
            <legend className="float-left text-lead font-bold text-ink">
              {row.blank ? labels.newRowTitle : labels.rowTitles[index]}
            </legend>
            <TextField
              id={`${id}-label`}
              name={name("label")}
              maxLength={120}
              label={labels.label}
              defaultValue={row.values.label}
              error={row.errors.label}
              className="clear-left"
            />
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`${id}-description`}
                className="font-semibold text-ink"
              >
                {labels.description}
              </label>
              <p
                id={`${id}-description-hint`}
                className="text-sm text-ink-muted"
              >
                {labels.descriptionHint}
              </p>
              {descriptionError ? (
                <p
                  id={`${id}-description-error`}
                  className="flex items-start gap-2 font-semibold text-danger"
                >
                  <OctagonAlert
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                  />
                  <span>{descriptionError}</span>
                </p>
              ) : null}
              <textarea
                id={`${id}-description`}
                name={name("description")}
                rows={2}
                maxLength={600}
                defaultValue={row.values.description}
                aria-describedby={cn(
                  `${id}-description-hint`,
                  descriptionError && `${id}-description-error`
                )}
                aria-invalid={descriptionError ? true : undefined}
                className={cn(inputStyles, "min-h-20")}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                id={`${id}-weight`}
                name={name("weight")}
                inputMode="numeric"
                label={labels.weight}
                defaultValue={row.values.weight}
                error={row.errors.weight}
              />
              <TextField
                id={`${id}-min`}
                name={name("minScore")}
                inputMode="numeric"
                label={labels.minScore}
                defaultValue={row.values.minScore}
                error={row.errors.minScore}
              />
              <TextField
                id={`${id}-max`}
                name={name("maxScore")}
                inputMode="numeric"
                label={labels.maxScore}
                defaultValue={row.values.maxScore}
                error={row.errors.maxScore}
              />
            </div>
            {row.blank ? null : (
              <label className="flex min-h-11 items-center gap-3 font-semibold text-ink">
                <input
                  type="checkbox"
                  name={name("remove")}
                  className="size-6 accent-primary"
                />
                {labels.remove}
              </label>
            )}
          </fieldset>
        );
      })}
      {view.total ? (
        <p className="font-semibold text-ink">{view.total}</p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <SubmitButton
          name="intent"
          value="save"
          variant="secondary"
          pendingLabel={labels.saving}
        >
          {labels.save}
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="publish"
          pendingLabel={labels.publishing}
        >
          {labels.publish}
        </SubmitButton>
      </div>
    </form>
  );
}
