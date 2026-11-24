"use client";

import { useActionState } from "react";

import {
  FormAlert,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";

import { saveCampaignAction } from "../_lib/actions";
import type { CampaignFormView, FieldName } from "../_lib/form";

export type CampaignFormLabels = {
  subject: string;
  subjectHint: string;
  body: string;
  bodyHint: string;
  segmentTitle: string;
  segmentLead: string;
  roles: string;
  rolesHint: string;
  competitions: string;
  competitionsHint: string;
  noCompetitions: string;
  cities: string;
  citiesHint: string;
  errors: Record<FieldName, string>;
  /** Form-wide problems by code: each refusal and `invalid_input`. */
  alerts: Record<string, string>;
  submit: string;
  submitting: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

export type Choice = { value: string; label: string };

const CHECK = "size-5 shrink-0 accent-current";
const CHOICE = "flex min-h-11 items-center gap-3";

function Choices({
  id,
  name,
  legend,
  hint,
  choices,
  chosen,
  empty,
}: {
  id: string;
  name: string;
  legend: string;
  hint: string;
  choices: readonly Choice[];
  chosen: readonly string[];
  empty?: string;
}) {
  return (
    <fieldset aria-describedby={`${id}-hint`} className="flex flex-col gap-1">
      <legend className="mb-2 font-semibold text-ink">{legend}</legend>
      <p id={`${id}-hint`} className="mb-2 text-sm text-ink-muted">
        {hint}
      </p>
      {choices.length === 0 && empty ? (
        <p className="text-ink-muted">{empty}</p>
      ) : (
        choices.map((choice) => (
          <div key={choice.value} className={CHOICE}>
            <input
              id={`${id}-${choice.value}`}
              type="checkbox"
              name={name}
              value={choice.value}
              defaultChecked={chosen.includes(choice.value)}
              className={CHECK}
            />
            <label
              htmlFor={`${id}-${choice.value}`}
              className="wrap-anywhere text-ink"
            >
              {choice.label}
            </label>
          </div>
        ))
      )}
    </fieldset>
  );
}

/**
 * The composer: creates a draft (no `campaignId`) or saves one. A refusal
 * shows here, each field at fault marked and what was typed kept; a change
 * that worked opens the campaign's page with a notice.
 */
export function CampaignForm({
  campaignId,
  revision,
  initial,
  roles,
  competitions,
  labels,
  labelledBy,
}: {
  campaignId: string | null;
  revision: number | null;
  initial: CampaignFormView;
  roles: readonly Choice[];
  competitions: readonly Choice[];
  labels: CampaignFormLabels;
  labelledBy?: string;
}) {
  const [view, formAction] = useActionState(saveCampaignAction, initial);
  const error = (name: FieldName) =>
    view.errors.includes(name) ? labels.errors[name] : undefined;
  const segmentError = error("segment");
  return (
    <form
      action={formAction}
      aria-labelledby={labelledBy}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="campaignId" value={campaignId ?? ""} />
      <input type="hidden" name="revision" value={revision ?? ""} />
      {view.alert.length > 0 || view.errors.length > 0 ? (
        <FormAlert tone="danger" label={labels.problem}>
          <ul className="list-disc pl-5">
            {(view.alert.length > 0 ? view.alert : ["invalid_input"]).map(
              (code) => (
                <li key={code}>
                  {labels.alerts[code] ?? labels.alerts.invalid_input}
                </li>
              )
            )}
          </ul>
        </FormAlert>
      ) : null}
      <TextField
        id="campaign-subject"
        name="subject"
        label={labels.subject}
        hint={labels.subjectHint}
        error={error("subject")}
        defaultValue={view.values.subject}
        maxLength={150}
        required
      />
      <TextAreaField
        id="campaign-body"
        name="body"
        label={labels.body}
        hint={labels.bodyHint}
        error={error("body")}
        defaultValue={view.values.body}
        maxLength={5000}
        rows={8}
        required
      />
      <section
        aria-labelledby="campaign-segment"
        className="flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
      >
        <h2 id="campaign-segment" className="text-h3 text-ink">
          {labels.segmentTitle}
        </h2>
        <p className="text-ink-muted">{labels.segmentLead}</p>
        {segmentError ? (
          <p className="font-semibold text-danger">{segmentError}</p>
        ) : null}
        <Choices
          id="campaign-roles"
          name="roles"
          legend={labels.roles}
          hint={labels.rolesHint}
          choices={roles}
          chosen={view.values.roles}
        />
        <Choices
          id="campaign-competitions"
          name="competitionIds"
          legend={labels.competitions}
          hint={labels.competitionsHint}
          choices={competitions}
          chosen={view.values.competitionIds}
          empty={labels.noCompetitions}
        />
        <TextField
          id="campaign-cities"
          name="cities"
          label={labels.cities}
          hint={labels.citiesHint}
          error={segmentError}
          defaultValue={view.values.cities}
        />
      </section>
      <div>
        <SubmitButton pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
