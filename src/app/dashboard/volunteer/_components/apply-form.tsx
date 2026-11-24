"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState, type ReactNode } from "react";

import {
  FormAlert,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";
import { cn } from "@/lib/utils";

import { applyAction } from "../_lib/actions";
import {
  IDLE,
  type ApplyField,
  type ApplyProblem,
  type ApplyState,
} from "../_lib/form-state";

// The volunteer application form (#123): the areas the member would like
// to help with, when they're free, their date of birth if no participant
// profile holds it, and the two declarations, each a box whose value is
// the version shown. It sends to its Server Action, so it works before the
// page hydrates; after a refusal it shows why and keeps what was sent.
// Every word comes in props.

type Option = { value: string; label: string };

type Declaration = {
  /** The form field: the box's value is this version's id. */
  name: "safeguardingDocumentId" | "conductDocumentId";
  documentId: string;
  label: string;
  /** The document's short points and full text, rendered on the server. */
  content: ReactNode;
};

export type ApplyFormLabels = {
  problem: string;
  problems: Record<ApplyProblem, string>;
  interests: { legend: string; hint: string; error: string };
  availability: {
    legend: string;
    hint: string;
    error: string;
    note: { label: string; hint: string };
  };
  dateOfBirth: { label: string; hint: string };
  declarations: { legend: string; hint: string; error: string };
  submit: string;
  submitting: string;
};

const BOX = "mt-0.5 size-6 shrink-0 accent-primary";
const CHOICE = "flex min-h-11 items-start gap-3 text-ink";
const GROUP =
  "flex flex-col gap-3 rounded-2xl border-2 border-border p-[min(1rem,6%)] data-invalid:border-danger";

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-2 font-semibold text-danger">
      <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function ApplyForm({
  interests,
  days,
  parts,
  asksDateOfBirth,
  noteMaxLength,
  declarations,
  labels,
}: {
  interests: readonly Option[];
  days: readonly Option[];
  parts: readonly Option[];
  asksDateOfBirth: boolean;
  noteMaxLength: number;
  declarations: readonly Declaration[];
  labels: ApplyFormLabels;
}) {
  const [state, formAction] = useActionState<ApplyState, FormData>(
    applyAction,
    IDLE
  );
  const { values } = state;
  const invalid = (field: ApplyField) => state.fields.includes(field);
  const declarationIds = new Set([
    values.safeguardingDocumentId,
    values.conductDocumentId,
  ]);

  return (
    <form
      action={formAction}
      noValidate
      aria-labelledby="apply-title"
      className="flex flex-col gap-6"
    >
      {state.problem ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.problems[state.problem]}</p>
        </FormAlert>
      ) : null}

      <fieldset
        className={GROUP}
        aria-describedby={cn(
          "interests-hint",
          invalid("interests") && "interests-error"
        )}
        data-invalid={invalid("interests") || undefined}
      >
        <legend className="px-1 font-semibold text-ink">
          {labels.interests.legend}
        </legend>
        <p id="interests-hint" className="text-sm text-ink-muted">
          {labels.interests.hint}
        </p>
        {invalid("interests") ? (
          <FieldError id="interests-error">{labels.interests.error}</FieldError>
        ) : null}
        <div className="grid gap-1 sm:grid-cols-2">
          {interests.map((interest) => (
            <label key={interest.value} className={CHOICE}>
              <input
                type="checkbox"
                name="interests"
                value={interest.value}
                defaultChecked={values.interests.includes(interest.value)}
                className={BOX}
              />
              <span className="min-w-0">{interest.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset
        className={GROUP}
        aria-describedby={cn(
          "availability-hint",
          invalid("availability") && "availability-error"
        )}
        data-invalid={invalid("availability") || undefined}
      >
        <legend className="px-1 font-semibold text-ink">
          {labels.availability.legend}
        </legend>
        <p id="availability-hint" className="text-sm text-ink-muted">
          {labels.availability.hint}
        </p>
        {invalid("availability") ? (
          <FieldError id="availability-error">
            {labels.availability.error}
          </FieldError>
        ) : null}
        <div className="flex flex-col gap-3">
          {days.map((day) => (
            <fieldset key={day.value} className="flex flex-col gap-1">
              <legend className="font-semibold text-ink">{day.label}</legend>
              <div className="flex flex-wrap gap-x-6">
                {parts.map((part) => {
                  const slot = `${day.value}:${part.value}`;
                  return (
                    <label key={slot} className={CHOICE}>
                      <input
                        type="checkbox"
                        name="slots"
                        value={slot}
                        defaultChecked={values.slots.includes(slot)}
                        className={BOX}
                      />
                      <span>{part.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <TextAreaField
          id="availability-note"
          name="note"
          rows={2}
          maxLength={noteMaxLength}
          label={labels.availability.note.label}
          hint={labels.availability.note.hint}
          defaultValue={values.note}
        />
      </fieldset>

      {asksDateOfBirth ? (
        <TextField
          id="date-of-birth"
          name="dateOfBirth"
          type="date"
          autoComplete="bday"
          required
          label={labels.dateOfBirth.label}
          hint={labels.dateOfBirth.hint}
          error={
            invalid("dateOfBirth") && state.problem
              ? labels.problems[state.problem]
              : undefined
          }
          defaultValue={values.dateOfBirth}
        />
      ) : null}

      <fieldset
        className={GROUP}
        aria-describedby={cn(
          "declarations-hint",
          invalid("declarations") && "declarations-error"
        )}
        data-invalid={invalid("declarations") || undefined}
      >
        <legend className="px-1 font-semibold text-ink">
          {labels.declarations.legend}
        </legend>
        <p id="declarations-hint" className="text-sm text-ink-muted">
          {labels.declarations.hint}
        </p>
        {invalid("declarations") ? (
          <FieldError id="declarations-error">
            {labels.declarations.error}
          </FieldError>
        ) : null}
        {declarations.map((declaration) => (
          <div key={declaration.name} className="flex flex-col gap-3">
            {declaration.content}
            <label className={cn(CHOICE, "font-semibold")}>
              <input
                type="checkbox"
                name={declaration.name}
                value={declaration.documentId}
                required
                defaultChecked={declarationIds.has(declaration.documentId)}
                className={BOX}
              />
              <span className="min-w-0">{declaration.label}</span>
            </label>
          </div>
        ))}
      </fieldset>

      <div>
        <SubmitButton pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
