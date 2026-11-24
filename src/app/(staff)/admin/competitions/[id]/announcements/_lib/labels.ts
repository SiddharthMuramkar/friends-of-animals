// The composer's words, from messages/en-IN/adminAnnouncements.json, for
// the client form (it takes them as props).

import { getTranslations } from "next-intl/server";

import type { AnnouncementFormLabels } from "../_components/announcement-form";
import { FIELDS, type FieldName } from "./form";

export async function formLabels(
  mode: "create" | "save"
): Promise<AnnouncementFormLabels> {
  const [t, common] = await Promise.all([
    getTranslations("adminAnnouncements"),
    getTranslations("common.callout"),
  ]);
  const fields = Object.fromEntries(
    FIELDS.map((name) => [name, t(`form.${name}`)])
  ) as Record<FieldName, string>;
  return {
    fields,
    hints: {
      subject: t("form.subjectHint"),
      eventAt: t("form.eventAtHint"),
      helpContacts: t("form.helpContactsHint"),
    },
    errors: {
      subject: t("form.errors.subject"),
      eventAt: t("form.errors.eventAt"),
      field: t("form.errors.field"),
    },
    alerts: {
      sections: t("form.errors.sections"),
      forbidden: t("refusals.forbidden"),
      not_found: t("refusals.not_found"),
      invalid_input: t("refusals.invalid_input"),
      announcement_not_editable: t("refusals.announcement_not_editable"),
    },
    submit: mode === "create" ? t("form.create") : t("form.save"),
    submitting: mode === "create" ? t("form.creating") : t("form.saving"),
    problem: common("danger"),
  };
}
