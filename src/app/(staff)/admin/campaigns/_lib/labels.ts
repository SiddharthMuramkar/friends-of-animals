// The composer's words and choices, from messages/en-IN/campaigns.json and
// the segment catalogue, for the client form (it takes them as props).

import { MILESTONE_KINDS } from "@/server/modules/community/domain/milestones";
import { getTranslations } from "next-intl/server";

import {
  SEGMENT_ROLES,
  type SegmentCompetition,
} from "@/server/modules/campaigns";

import type { CampaignFormLabels, Choice } from "../_components/campaign-form";

export async function formLabels(
  mode: "create" | "save"
): Promise<CampaignFormLabels> {
  const [t, callout] = await Promise.all([
    getTranslations("campaigns.admin.form"),
    getTranslations("common.callout"),
  ]);
  return {
    subject: t("subject"),
    subjectHint: t("subjectHint"),
    body: t("body"),
    bodyHint: t("bodyHint"),
    segmentTitle: t("segmentTitle"),
    segmentLead: t("segmentLead"),
    roles: t("roles"),
    rolesHint: t("rolesHint"),
    milestones: t("milestones"),
    milestonesHint: t("milestonesHint"),
    competitions: t("competitions"),
    competitionsHint: t("competitionsHint"),
    noCompetitions: t("noCompetitions"),
    cities: t("cities"),
    citiesHint: t("citiesHint"),
    errors: {
      subject: t("errors.subject"),
      body: t("errors.body"),
      segment: t("errors.segment"),
    },
    alerts: {
      invalid_input: t("errors.invalid_input"),
      forbidden: t("errors.forbidden"),
      not_found: t("errors.not_found"),
      campaign_not_editable: t("errors.campaign_not_editable"),
      campaign_draft_changed: t("errors.campaign_draft_changed"),
    },
    submit: mode === "create" ? t("create") : t("save"),
    submitting: mode === "create" ? t("creating") : t("saving"),
    problem: callout("danger"),
  };
}

/** Each role a segment can name, as the form lists it. */
export async function roleChoices(): Promise<Choice[]> {
  const t = await getTranslations("campaigns.admin.roles");
  return SEGMENT_ROLES.map((role) => ({ value: role, label: t(role) }));
}

/** Each competition, as the form lists it. */
export function competitionChoices(
  competitions: readonly SegmentCompetition[]
): Choice[] {
  return competitions.map(({ id, code, name }) => ({
    value: id,
    label: `${name} (${code})`,
  }));
}

export async function milestoneChoices(): Promise<Choice[]> {
  const t = await getTranslations("community.timeline.milestones");
  return MILESTONE_KINDS.map((kind) => ({ value: kind, label: t(kind) }));
}
