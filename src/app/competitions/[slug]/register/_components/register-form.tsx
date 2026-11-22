"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/form";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";

import { registerAsIndividualAction } from "../_lib/actions";
import {
  START,
  type FormField,
  type RegisterFormState,
  type TextField as Field,
} from "../_lib/form-state";
import type { Refusal } from "../_lib/refusal";

export type RegisterFormLabels = {
  fields: Record<Field | "consents", string>;
  hints: Partial<Record<Field, string>>;
  invalid: Record<FormField, string>;
  refusals: Record<Refusal, string>;
  /** One per document: "I agree to the …", and the link to read it. */
  documents: {
    documentId: string;
    label: string;
    link: string;
    href: string;
  }[];
  countries: { value: string; label: string }[];
  countryPlaceholder: string;
  problems: string;
  unexpected: string;
  submit: string;
  submitting: string;
  dashboardLink: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const FIELDSET =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LEGEND = "px-2 text-lead font-bold text-ink";
const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * The individual register form (#78). Every word comes in `labels`; the
 * action returns what to fix, or a refusal, and keeps what was typed.
 */
export function RegisterForm({
  competitionSlug,
  labels,
}: {
  competitionSlug: string;
  labels: RegisterFormLabels;
}) {
  const [state, formAction] = useActionState(
    registerAsIndividualAction.bind(null, competitionSlug),
    START
  );
  const { values } = state;
  const errorOf = (field: FormField): string | undefined => {
    if (!state.errors.includes(field)) return undefined;
    // A refusal tied to the field says why in its own words.
    return state.refusal
      ? labels.refusals[state.refusal]
      : labels.invalid[field];
  };
  const text = (
    field: Field,
    input: Partial<Parameters<typeof TextField>[0]> = {}
  ) => (
    <TextField
      id={field}
      name={field}
      required
      defaultValue={values[field]}
      label={labels.fields[field]}
      hint={labels.hints[field]}
      error={errorOf(field)}
      {...input}
    />
  );
  const consentError = errorOf("consents");
  // A refusal no field can fix shows above the form.
  const formLevel =
    state.refusal && state.errors.length === 0
      ? labels.refusals[state.refusal]
      : state.unexpected
        ? labels.unexpected
        : state.errors.length > 0
          ? labels.problems
          : null;

  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-8"
    >
      {formLevel ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{formLevel}</p>
          {state.refusal === "already_registered" ? (
            <p>
              <SiteLink href={APP_ROUTES.participant} className={LINK}>
                {labels.dashboardLink}
              </SiteLink>
            </p>
          ) : null}
        </FormAlert>
      ) : null}

      <fieldset className={FIELDSET}>
        {text("fullName", { autoComplete: "name", maxLength: 100 })}
        {text("dateOfBirth", { type: "date", autoComplete: "bday" })}
        {text("phone", {
          type: "tel",
          autoComplete: "tel",
          inputMode: "tel",
          maxLength: 32,
        })}
        {text("pinCode", { autoComplete: "postal-code", maxLength: 12 })}
        {text("city", { autoComplete: "address-level2", maxLength: 80 })}
        {text("state", { autoComplete: "address-level1", maxLength: 60 })}
        <SelectField
          id="country"
          name="country"
          required
          autoComplete="country"
          defaultValue={values.country}
          label={labels.fields.country}
          placeholder={labels.countryPlaceholder}
          options={labels.countries}
          error={errorOf("country")}
        />
        {text("schoolName", {
          required: false,
          autoComplete: "organization",
          maxLength: 150,
        })}
      </fieldset>

      <fieldset
        className={FIELDSET}
        aria-describedby={consentError ? "consents-error" : undefined}
      >
        <legend className={LEGEND}>{labels.fields.consents}</legend>
        {consentError ? (
          <p
            id="consents-error"
            className="flex items-start gap-2 font-semibold text-danger"
          >
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0"
            />
            <span>{consentError}</span>
          </p>
        ) : null}
        {labels.documents.map((document) => (
          <div key={document.documentId} className="flex flex-col gap-1">
            <label className="flex min-h-11 items-start gap-3 font-semibold text-ink">
              <input
                type="checkbox"
                name="consents"
                value={document.documentId}
                defaultChecked={values.consents.includes(document.documentId)}
                aria-invalid={consentError ? true : undefined}
                className="mt-0.5 size-6 shrink-0 accent-primary"
              />
              <span className="min-w-0">{document.label}</span>
            </label>
            <SiteLink href={document.href} className={`${LINK} ms-9`}>
              {document.link}
            </SiteLink>
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

export type { RegisterFormState };
