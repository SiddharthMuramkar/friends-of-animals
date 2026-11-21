"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState, type ReactNode } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import type { InstitutionType } from "@/server/institutions";

import { registerInstitutionAction } from "../_lib/actions";
import {
  START,
  type RegistrationAlert,
  type RegistrationField,
} from "../_lib/form-state";

type FieldLabels = { label: string; hint?: string; error: string };

export type RegistrationFormLabels = {
  sections: Record<"institution" | "address" | "contact" | "principal", string>;
  fields: Record<RegistrationField, FieldLabels>;
  types: Record<InstitutionType, string>;
  alerts: Record<RegistrationAlert, string>;
  submit: string;
  submitting: string;
  myInstitution: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const TYPES: readonly InstitutionType[] = [
  "school",
  "college",
  "university",
  "other",
];

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

const FIELDSET =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LEGEND = "px-2 text-lead font-bold text-ink";

/** The label, hint and error around a select or textarea, as TextField has. */
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
      {error ? (
        <p
          id={`${id}-error`}
          className="flex items-start gap-2 font-semibold text-danger"
        >
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
      {children}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return (
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

/**
 * Registering an institution, in four groups. Every word comes in
 * `labels`; the action returns which fields to fix and keeps what was
 * typed.
 */
export function RegistrationForm({
  labels,
}: {
  labels: RegistrationFormLabels;
}) {
  const [state, formAction] = useActionState(registerInstitutionAction, START);
  const { values } = state;
  const errorOf = (field: RegistrationField) =>
    state.errors.includes(field) ? labels.fields[field].error : undefined;
  const text = (
    field: RegistrationField,
    input: Partial<Parameters<typeof TextField>[0]> = {}
  ) => (
    <TextField
      id={field}
      name={field}
      required
      defaultValue={values[field]}
      label={labels.fields[field].label}
      hint={labels.fields[field].hint}
      error={errorOf(field)}
      {...input}
    />
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
      {state.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
          {state.alert === "already_registered" ? (
            <p>
              <SiteLink href={APP_ROUTES.myInstitution} className={LINK}>
                {labels.myInstitution}
              </SiteLink>
            </p>
          ) : null}
        </FormAlert>
      ) : null}

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.institution}</legend>
        {text("name", { autoComplete: "organization", maxLength: 200 })}
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
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {labels.types[type]}
              </option>
            ))}
          </select>
        </Labelled>
        {text("expectedParticipants", {
          type: "number",
          inputMode: "numeric",
          min: 1,
          max: 100_000,
          step: 1,
        })}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.address}</legend>
        <Labelled
          id="address"
          label={labels.fields.address.label}
          hint={labels.fields.address.hint}
          error={errorOf("address")}
        >
          <textarea
            id="address"
            name="address"
            required
            rows={3}
            maxLength={500}
            autoComplete="street-address"
            defaultValue={values.address}
            aria-describedby={describedBy(
              "address",
              labels.fields.address.hint,
              errorOf("address")
            )}
            aria-invalid={errorOf("address") ? true : undefined}
            className={inputStyles}
          />
        </Labelled>
        {text("pinCode", {
          inputMode: "numeric",
          autoComplete: "postal-code",
          maxLength: 6,
        })}
        {text("city", { autoComplete: "address-level2", maxLength: 100 })}
        {text("state", { autoComplete: "address-level1", maxLength: 100 })}
        {text("country", { autoComplete: "country-name", maxLength: 100 })}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.contact}</legend>
        {text("contactEmail", {
          type: "email",
          autoComplete: "email",
          spellCheck: false,
          maxLength: 254,
        })}
        {text("contactPhone", {
          type: "tel",
          autoComplete: "tel",
          maxLength: 20,
        })}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>{labels.sections.principal}</legend>
        {text("principalName", { autoComplete: "off", maxLength: 200 })}
        {text("principalEmail", {
          type: "email",
          autoComplete: "off",
          spellCheck: false,
          maxLength: 254,
        })}
        {text("principalPhone", {
          type: "tel",
          autoComplete: "off",
          maxLength: 20,
        })}
      </fieldset>

      <div>
        <SubmitButton size="lg" pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
