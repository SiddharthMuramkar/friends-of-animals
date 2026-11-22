"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState, useEffect } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/form";
import { inlineLink } from "@/components/site/link-styles";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { cn } from "@/lib/utils";

import { registerAsIndividualAction } from "../_lib/actions";
import {
  START,
  type FormField,
  type GuardianField,
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
  /** A teen's parent or guardian (#81). */
  guardian: {
    legend: string;
    lead: string;
    fields: Record<GuardianField, string>;
    emailHint: string;
    relationships: { value: string; label: string }[];
    relationshipPlaceholder: string;
  };
  problems: string;
  unexpected: string;
  submit: string;
  submitting: string;
  dashboardLink: string;
  /** Registered, while the next page loads. */
  registered: string;
  /** The next page's link, for a browser that doesn't load it by itself. */
  continueLink: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  success: string;
};

const FIELDSET =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LEGEND = "px-2 text-lead font-bold text-ink";

/**
 * The individual register form (#78, #81). Every word comes in `labels`;
 * the action returns what to fix, or a refusal, and keeps what was typed.
 * A child's, or a linked teen's, name and date of birth are the profile's:
 * `kept` shows them in place of their fields. A teen on their own is asked
 * for their parent or guardian once registering says so. Once registered,
 * it hands back the next page, which the browser loads.
 */
export function RegisterForm({
  competitionSlug,
  forChildId,
  kept,
  labels,
}: {
  competitionSlug: string;
  /** The child a guardian is registering, if any. */
  forChildId: string | null;
  /** The profile's name and date of birth, and where they come from. */
  kept: { summary: string; note: string } | null;
  labels: RegisterFormLabels;
}) {
  const [state, formAction] = useActionState(
    registerAsIndividualAction.bind(null, competitionSlug, forChildId),
    START
  );
  const { values, destination } = state;
  // Registered: the next page (the pay page), loaded in full so its CSP
  // and headers come with its own document. A client-side navigation would
  // keep this page's.
  useEffect(() => {
    if (destination) window.location.assign(destination);
  }, [destination]);
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
  const guardianText = (
    field: Exclude<GuardianField, "guardianRelationship">,
    input: Partial<Parameters<typeof TextField>[0]> = {}
  ) => (
    <TextField
      id={field}
      name={field}
      required
      defaultValue={values[field]}
      label={labels.guardian.fields[field]}
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

  if (destination) {
    return (
      <FormAlert tone="success" label={labels.success}>
        <p>{labels.registered}</p>
        <p>
          {/* A plain link: a full load, like the one above. */}
          <a href={destination} className={inlineLink}>
            {labels.continueLink}
          </a>
        </p>
      </FormAlert>
    );
  }

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
              <SiteLink href={APP_ROUTES.participant} className={inlineLink}>
                {labels.dashboardLink}
              </SiteLink>
            </p>
          ) : null}
        </FormAlert>
      ) : null}

      <fieldset className={FIELDSET}>
        {kept ? (
          <div>
            <p className="text-lead font-semibold text-ink">{kept.summary}</p>
            <p className="mt-1 text-ink-muted">{kept.note}</p>
          </div>
        ) : (
          <>
            {text("fullName", { autoComplete: "name", maxLength: 100 })}
            {text("dateOfBirth", { type: "date", autoComplete: "bday" })}
          </>
        )}
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

      {state.askGuardian ? (
        <fieldset className={FIELDSET} aria-describedby="guardian-lead">
          <legend className={LEGEND}>{labels.guardian.legend}</legend>
          <p id="guardian-lead" className="text-ink">
            {labels.guardian.lead}
          </p>
          {guardianText("guardianName", {
            autoComplete: "off",
            maxLength: 100,
          })}
          <SelectField
            id="guardianRelationship"
            name="guardianRelationship"
            required
            defaultValue={values.guardianRelationship}
            label={labels.guardian.fields.guardianRelationship}
            placeholder={labels.guardian.relationshipPlaceholder}
            options={labels.guardian.relationships}
            error={errorOf("guardianRelationship")}
          />
          {guardianText("guardianEmail", {
            type: "email",
            autoComplete: "off",
            inputMode: "email",
            maxLength: 254,
            hint: labels.guardian.emailHint,
          })}
        </fieldset>
      ) : null}

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
            <SiteLink href={document.href} className={cn(inlineLink, "ms-9")}>
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
