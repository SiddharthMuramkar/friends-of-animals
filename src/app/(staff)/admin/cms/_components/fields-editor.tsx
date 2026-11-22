"use client";

import { useActionState, type ReactNode } from "react";

import { FormAlert, inputStyles, SubmitButton } from "@/components/form";
import { cn } from "@/lib/utils";
import type { CmsDocumentKey } from "@/server/modules/cms/domain/documents";

import { saveFieldsDraftAction } from "../_lib/actions";
import type { FieldsEditorView } from "../_lib/editor-state";
import type { FieldInput, FormValues } from "../_lib/kind-forms";

/** A field as the page hands it over: its words already translated. */
export type EditorField = {
  name: string;
  input: FieldInput;
  label: string;
  hint?: string;
  maxLength?: number;
  optional?: boolean;
  /** For select, toggles and counts: each option's value and words. */
  options?: { value: string; label: string; name?: string }[];
  /** For toggles and counts: the hidden field holding their order. */
  orderName?: string;
};

export type EditorGroup = { legend: string; fields: EditorField[] };

export type FieldsEditorLabels = {
  lead: string;
  save: string;
  saving: string;
  problem: string;
  none: string;
  other: string;
};

/** Ids built from a field's dotted name; unique on the page. */
function idOf(name: string): string {
  return `cms-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

const ROWS: Partial<Record<FieldInput, number>> = {
  textarea: 3,
  lines: 5,
  markup: 6,
  titled: 10,
};

/**
 * A home, about, impact or site facts draft as a form, prefilled from the
 * draft (or the published body, or the seed). Save stores it as the
 * draft; a refusal comes back with what was typed and each problem beside
 * its field. Every word comes translated from the page or the action.
 */
export function FieldsEditor({
  documentKey,
  groups,
  defaultValues,
  labels,
}: {
  documentKey: CmsDocumentKey;
  groups: EditorGroup[];
  defaultValues: FormValues;
  labels: FieldsEditorLabels;
}) {
  const [view, formAction] = useActionState<FieldsEditorView | null, FormData>(
    saveFieldsDraftAction,
    null
  );
  const values = view?.values ?? defaultValues;
  const errors = view?.errors ?? {};
  const unplaced = errors[""] ?? [];

  const textOf = (name: string) => {
    const value = values[name];
    return typeof value === "string" ? value : "";
  };

  return (
    <form action={formAction} noValidate className="flex flex-col gap-8">
      <input type="hidden" name="key" value={documentKey} />
      <p className="text-ink-muted">{labels.lead}</p>

      {view?.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.alert}</p>
          {unplaced.length > 0 ? (
            <>
              <p>{labels.other}</p>
              <ul className="list-disc pl-5">
                {unplaced.map((issue, k) => (
                  <li key={k}>{issue}</li>
                ))}
              </ul>
            </>
          ) : null}
        </FormAlert>
      ) : null}

      {groups.map((group) => (
        <fieldset
          key={group.legend}
          className="flex flex-col gap-5 border-t-2 border-border pt-5"
        >
          <legend className="float-left mb-1 w-full text-h4 font-bold text-ink">
            {group.legend}
          </legend>
          {group.fields.map((field) => (
            <FieldView
              key={field.name}
              field={field}
              values={values}
              text={textOf(field.name)}
              errors={errors[field.name] ?? []}
              optionErrors={errors}
              noneLabel={labels.none}
            />
          ))}
        </fieldset>
      ))}

      <div>
        <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}

function ErrorList({ id, errors }: { id: string; errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul id={id} className="flex flex-col gap-1 font-semibold text-danger">
      {errors.map((error, k) => (
        <li key={k}>{error}</li>
      ))}
    </ul>
  );
}

function Described({
  field,
  errors,
  children,
}: {
  field: EditorField;
  errors: string[];
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const id = idOf(field.name);
  const describedBy = cn(
    field.hint && `${id}-hint`,
    errors.length > 0 && `${id}-error`
  );
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold text-ink">
        {field.label}
      </label>
      {field.hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {field.hint}
        </p>
      ) : null}
      <ErrorList id={`${id}-error`} errors={errors} />
      {children(describedBy || undefined)}
    </div>
  );
}

function FieldView({
  field,
  values,
  text,
  errors,
  optionErrors,
  noneLabel,
}: {
  field: EditorField;
  values: FormValues;
  text: string;
  errors: string[];
  optionErrors: Record<string, string[]>;
  noneLabel: string;
}) {
  const id = idOf(field.name);
  const invalid = errors.length > 0 ? true : undefined;

  if (field.input === "toggles" || field.input === "counts") {
    const groupErrorId = `${id}-error`;
    return (
      <fieldset
        aria-describedby={cn(
          field.hint && `${id}-hint`,
          errors.length > 0 && groupErrorId
        )}
        className="flex flex-col gap-3"
      >
        <legend className="font-semibold text-ink">{field.label}</legend>
        {field.hint ? (
          <p id={`${id}-hint`} className="text-sm text-ink-muted">
            {field.hint}
          </p>
        ) : null}
        <ErrorList id={groupErrorId} errors={errors} />
        {field.orderName ? (
          <input
            type="hidden"
            name={field.orderName}
            value={(field.options ?? []).map((o) => o.value).join(",")}
          />
        ) : null}
        <ul
          className={cn(
            "grid gap-3",
            field.input === "toggles" ? "sm:grid-cols-2" : "sm:grid-cols-3"
          )}
        >
          {(field.options ?? []).map((option) => {
            const name = option.name ?? `${field.name}.${option.value}`;
            const optionId = idOf(name);
            if (field.input === "toggles") {
              return (
                <li key={option.value}>
                  <label
                    htmlFor={optionId}
                    className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold text-ink"
                  >
                    <input
                      id={optionId}
                      type="checkbox"
                      name={name}
                      defaultChecked={values[name] === true}
                      className="size-5 accent-ink"
                    />
                    {option.label}
                  </label>
                </li>
              );
            }
            const own = optionErrors[name] ?? [];
            const value = values[name];
            return (
              <li key={option.value} className="flex flex-col gap-2">
                <label htmlFor={optionId} className="font-semibold text-ink">
                  {option.label}
                </label>
                <ErrorList id={`${optionId}-error`} errors={own} />
                <input
                  id={optionId}
                  name={name}
                  type="text"
                  inputMode="numeric"
                  defaultValue={typeof value === "string" ? value : ""}
                  aria-describedby={
                    own.length > 0 ? `${optionId}-error` : undefined
                  }
                  aria-invalid={own.length > 0 ? true : undefined}
                  className={inputStyles}
                />
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  }

  return (
    <Described field={field} errors={errors}>
      {(describedBy) => {
        const shared = {
          id,
          name: field.name,
          "aria-describedby": describedBy,
          "aria-invalid": invalid,
        };
        switch (field.input) {
          case "select":
            return (
              <select
                {...shared}
                defaultValue={text}
                className={cn(inputStyles, "max-w-xl")}
              >
                {field.optional || text === "" ? (
                  <option value="">{noneLabel}</option>
                ) : null}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            );
          case "date":
            return (
              <input
                {...shared}
                type="date"
                defaultValue={text}
                className={cn(inputStyles, "max-w-xs")}
              />
            );
          case "text":
            return (
              <input
                {...shared}
                type="text"
                maxLength={field.maxLength}
                defaultValue={text}
                className={inputStyles}
              />
            );
          default:
            return (
              <textarea
                {...shared}
                rows={ROWS[field.input] ?? 3}
                maxLength={
                  field.input === "textarea" ? field.maxLength : undefined
                }
                spellCheck
                defaultValue={text}
                className={cn(
                  inputStyles,
                  field.input === "markup" &&
                    "font-mono text-sm leading-relaxed"
                )}
              />
            );
        }
      }}
    </Described>
  );
}
