"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState, type ReactNode } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { cn } from "@/lib/utils";
import {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
  PUBLIC_CONTACT_FIELDS,
  type DirectoryService,
  type ListingType,
  type PublicContactField,
} from "@/server/modules/directory/domain/catalogue";
import type { ListingField } from "@/server/modules/directory/domain/listing-input";

import type {
  ListingFormAlert,
  ListingFormState,
  ListingFormValues,
} from "./listing-form-state";

type FieldLabels = { label: string; hint?: string; error: string };

export type ListingFormLabels = {
  sections: Record<"about" | "area" | "contact" | "public", string>;
  fields: Record<ListingField, FieldLabels>;
  types: Record<ListingType, string>;
  services: Record<DirectoryService, string>;
  publicContact: Record<PublicContactField, string>;
  alerts: Record<ListingFormAlert, string>;
  submit: string;
  submitting: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const FIELDSET =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LEGEND = "px-2 text-lead font-bold text-ink";

function describedBy(id: string, hint?: string, error?: string) {
  return (
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

function ErrorLine({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p
      id={`${id}-error`}
      className="flex items-start gap-2 font-semibold text-danger"
    >
      <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{error}</span>
    </p>
  ) : null;
}

/** The label, hint and error around a select or textarea. */
function Labelled({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
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
      <ErrorLine id={id} error={error} />
      {children}
    </div>
  );
}

/** A group of checkboxes with one legend, hint and error. */
function Checkboxes<T extends string>({
  id,
  name,
  labels,
  options,
  chosen,
  optionLabels,
  error,
}: {
  id: string;
  name: string;
  labels: FieldLabels;
  options: readonly T[];
  chosen: readonly string[];
  optionLabels: Record<T, string>;
  error?: string;
}) {
  return (
    <fieldset
      aria-describedby={describedBy(id, labels.hint, error)}
      className="flex flex-col gap-2"
    >
      <legend className="font-semibold text-ink">{labels.label}</legend>
      {labels.hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {labels.hint}
        </p>
      ) : null}
      <ErrorLine id={id} error={error} />
      <div className="grid gap-x-4 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option}
            className="flex min-h-11 items-center gap-3 py-1 text-ink"
          >
            <input
              type="checkbox"
              name={name}
              value={option}
              defaultChecked={chosen.includes(option)}
              className="size-5 shrink-0 accent-link"
            />
            <span>{optionLabels[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A directory listing's details, in four groups: registering one and
 * editing one. Every word comes in `labels`; the action returns which
 * fields to fix and keeps what was typed.
 */
export function ListingForm({
  action,
  start,
  labels,
  hidden,
  alertExtra,
}: {
  action: (
    previous: ListingFormState,
    formData: FormData
  ) => Promise<ListingFormState>;
  start: ListingFormState;
  labels: ListingFormLabels;
  /** Hidden fields the action needs, such as the listing's id. */
  hidden?: Record<string, string>;
  /** Shown under an alert, such as a link to the person's listings. */
  alertExtra?: Partial<Record<ListingFormAlert, ReactNode>>;
}) {
  const [state, formAction] = useActionState(action, start);
  const values: ListingFormValues = state.values;
  const errorOf = (field: ListingField) =>
    state.errors.includes(field) ? labels.fields[field].error : undefined;
  const text = (
    field: Exclude<
      ListingField,
      "type" | "services" | "publicContactFields" | "description" | "address"
    >,
    input: Partial<Parameters<typeof TextField>[0]> = {}
  ) => (
    <TextField
      id={field}
      name={field}
      defaultValue={values[field]}
      label={labels.fields[field].label}
      hint={labels.fields[field].hint}
      error={errorOf(field)}
      {...input}
    />
  );
  const area = (
    field: "description" | "address",
    rows: number,
    max: number
  ) => (
    <Labelled
      id={field}
      label={labels.fields[field].label}
      hint={labels.fields[field].hint}
      error={errorOf(field)}
    >
      <textarea
        id={field}
        name={field}
        required
        rows={rows}
        maxLength={max}
        defaultValue={values[field]}
        aria-describedby={describedBy(
          field,
          labels.fields[field].hint,
          errorOf(field)
        )}
        aria-invalid={errorOf(field) ? true : undefined}
        className={inputStyles}
      />
    </Labelled>
  );

  return (
    // A new key per submission remounts the inputs with what was typed:
    // React resets a form after its action runs.
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-8"
    >
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
          {alertExtra?.[state.alert] ?? null}
        </FormAlert>
      ) : null}

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.about}</legend>
        <Labelled
          id="type"
          label={labels.fields.type.label}
          error={errorOf("type")}
        >
          <select
            id="type"
            name="type"
            defaultValue={values.type}
            aria-describedby={describedBy("type", undefined, errorOf("type"))}
            aria-invalid={errorOf("type") ? true : undefined}
            className={inputStyles}
          >
            {LISTING_TYPES.map((type) => (
              <option key={type} value={type}>
                {labels.types[type]}
              </option>
            ))}
          </select>
        </Labelled>
        {text("name", {
          required: true,
          autoComplete: "organization",
          maxLength: 120,
        })}
        {area("description", 5, 2000)}
        <Checkboxes
          id="services"
          name="services"
          labels={labels.fields.services}
          options={DIRECTORY_SERVICES}
          chosen={values.services}
          optionLabels={labels.services}
          error={errorOf("services")}
        />
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.area}</legend>
        {area("address", 3, 300)}
        {text("city", {
          required: true,
          autoComplete: "address-level2",
          maxLength: 80,
        })}
        {text("state", {
          required: true,
          autoComplete: "address-level1",
          maxLength: 80,
        })}
        {text("pinCode", {
          required: true,
          inputMode: "numeric",
          autoComplete: "postal-code",
          maxLength: 7,
        })}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.contact}</legend>
        {text("contactPhone", {
          required: true,
          type: "tel",
          autoComplete: "tel",
          maxLength: 20,
        })}
        {text("contactEmail", {
          type: "email",
          autoComplete: "email",
          spellCheck: false,
          maxLength: 254,
        })}
        {text("website", {
          type: "text",
          inputMode: "url",
          autoComplete: "url",
          spellCheck: false,
          maxLength: 200,
        })}
      </fieldset>

      <fieldset className={cn(FIELDSET)}>
        <legend className={LEGEND}>{labels.sections.public}</legend>
        <Checkboxes
          id="publicContactFields"
          name="publicContactFields"
          labels={labels.fields.publicContactFields}
          options={PUBLIC_CONTACT_FIELDS}
          chosen={values.publicContactFields}
          optionLabels={labels.publicContact}
          error={errorOf("publicContactFields")}
        />
      </fieldset>

      <div>
        <SubmitButton size="lg" pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
