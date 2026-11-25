// The campaign composer's form: what it posts, read into a use case's
// input, and the view it shows again after a refusal, with what was typed
// kept and each field at fault marked. The use case validates; this only
// reads.

import type { CampaignDraftInput } from "@/server/modules/campaigns";

export const FIELDS = ["subject", "body", "segment"] as const;
export type FieldName = (typeof FIELDS)[number];

export type CampaignFormValues = {
  subject: string;
  body: string;
  roles: string[];
  competitionIds: string[];
  milestones: string[];
  /** As typed: comma-separated. */
  cities: string;
};

export type CampaignFormView = {
  values: CampaignFormValues;
  /** The fields at fault. */
  errors: FieldName[];
  /** Form-wide refusals, by code. */
  alert: string[];
};

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function texts(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

/** What the form posted, as typed. */
export function formValues(form: FormData): CampaignFormValues {
  return {
    subject: text(form, "subject"),
    body: text(form, "body"),
    roles: texts(form, "roles"),
    competitionIds: texts(form, "competitionIds"),
    milestones: texts(form, "milestones"),
    cities: text(form, "cities"),
  };
}

/** Splits the typed cities on commas, dropping empty ones. */
export function citiesOf(typed: string): string[] {
  return typed
    .split(",")
    .map((city) => city.trim())
    .filter((city) => city !== "");
}

/** The use case's input, unvalidated. */
export function draftInput(values: CampaignFormValues): CampaignDraftInput {
  return {
    subject: values.subject,
    body: values.body,
    segment: {
      roles: values.roles,
      competitionIds: values.competitionIds,
      ...(values.milestones.length ? { milestones: values.milestones } : {}),
      cities: citiesOf(values.cities),
    } as CampaignDraftInput["segment"],
  };
}

/** The composer's first view: empty, or a draft's own values. */
export function campaignFormView(
  draft: CampaignDraftInput | null
): CampaignFormView {
  return {
    values: draft
      ? {
          subject: draft.subject,
          body: draft.body,
          roles: draft.segment.roles,
          competitionIds: draft.segment.competitionIds,
          milestones: draft.segment.milestones ?? [],
          cities: draft.segment.cities.join(", "),
        }
      : {
          subject: "",
          body: "",
          roles: [],
          competitionIds: [],
          milestones: [],
          cities: "",
        },
    errors: [],
    alert: [],
  };
}

/** The view after a refusal: fields at fault, or a form-wide code. */
export function refusedView(
  values: CampaignFormValues,
  refusal: { fields: string[] } | { code: string }
): CampaignFormView {
  if ("code" in refusal) return { values, errors: [], alert: [refusal.code] };
  const errors = FIELDS.filter((field) => refusal.fields.includes(field));
  return {
    values,
    errors,
    alert: errors.length === 0 ? ["invalid_input"] : [],
  };
}
