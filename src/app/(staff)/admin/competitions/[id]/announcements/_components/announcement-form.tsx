"use client";

import { useActionState } from "react";

import {
  FormAlert,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";

import { saveAnnouncementAction } from "../_lib/actions";
import type { AnnouncementFormView, FieldError, FieldName } from "../_lib/form";

export type AnnouncementFormLabels = {
  fields: Record<FieldName, string>;
  hints: Partial<Record<FieldName, string>>;
  errors: Record<FieldError, string>;
  /** Form-wide problems by code: `sections` and each refusal. */
  alerts: Record<string, string>;
  submit: string;
  submitting: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/** The sections after the subject and the event's time, as textareas. */
const SECTIONS = [
  "confirmedTheme",
  "permittedMaterials",
  "duration",
  "submissionSteps",
  "physicalArtworkRequirements",
  "deadlines",
  "helpContacts",
  "message",
] as const satisfies readonly FieldName[];

/** One-line sections; the rest take paragraphs. */
const SHORT: readonly FieldName[] = ["confirmedTheme", "duration"];

/**
 * The composer: creates a draft (no `announcementId`) or saves one. A
 * refusal shows here, each field at fault marked and what was typed kept;
 * a change that worked opens the announcement's page with a notice.
 */
export function AnnouncementForm({
  competitionId,
  announcementId,
  initial,
  labels,
  labelledBy,
}: {
  competitionId: string;
  announcementId: string | null;
  initial: AnnouncementFormView;
  labels: AnnouncementFormLabels;
  labelledBy?: string;
}) {
  const [view, formAction] = useActionState(saveAnnouncementAction, initial);
  const error = (name: FieldName) => {
    const code = view.errors[name];
    return code ? labels.errors[code] : undefined;
  };
  return (
    <form
      action={formAction}
      aria-labelledby={labelledBy}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="announcementId" value={announcementId ?? ""} />
      {view.alert.length > 0 || Object.keys(view.errors).length > 0 ? (
        <FormAlert tone="danger" label={labels.problem}>
          {view.alert.length > 0 ? (
            <ul className="list-disc pl-5">
              {view.alert.map((code) => (
                <li key={code}>
                  {labels.alerts[code] ?? labels.alerts.invalid_input}
                </li>
              ))}
            </ul>
          ) : (
            <p>{labels.alerts.invalid_input}</p>
          )}
        </FormAlert>
      ) : null}
      <TextField
        id="announcement-subject"
        name="subject"
        label={labels.fields.subject}
        hint={labels.hints.subject}
        error={error("subject")}
        defaultValue={view.values.subject}
        maxLength={150}
        required
      />
      <TextField
        id="announcement-event-at"
        name="eventAt"
        type="datetime-local"
        label={labels.fields.eventAt}
        hint={labels.hints.eventAt}
        error={error("eventAt")}
        defaultValue={view.values.eventAt}
      />
      {SECTIONS.map((name) =>
        SHORT.includes(name) ? (
          <TextField
            key={name}
            id={`announcement-${name}`}
            name={name}
            label={labels.fields[name]}
            hint={labels.hints[name]}
            error={error(name)}
            defaultValue={view.values[name]}
          />
        ) : (
          <TextAreaField
            key={name}
            id={`announcement-${name}`}
            name={name}
            label={labels.fields[name]}
            hint={labels.hints[name]}
            error={error(name)}
            defaultValue={view.values[name]}
            rows={4}
          />
        )
      )}
      <div>
        <SubmitButton pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
