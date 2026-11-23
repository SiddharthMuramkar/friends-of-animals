import { getTranslations } from "next-intl/server";

import type { BreachFormLabels } from "../_components/breach-fields";

export async function breachDetailsLabels(
  editing = false
): Promise<BreachFormLabels> {
  const [t, common] = await Promise.all([
    getTranslations("adminBreaches"),
    getTranslations("common"),
  ]);
  return {
    form: t(editing ? "forms.edit" : "forms.record"),
    submit: t(editing ? "forms.editSubmit" : "forms.recordSubmit"),
    pending: t("forms.pending"),
    problem: common("callout.danger"),
    invalid: t("errors.invalid_input"),
    awareInFuture: t("errors.aware_in_future"),
    fields: {
      title: t("fields.title"),
      titleHint: t("fields.titleHint"),
      awareAt: t("fields.awareAtInput"),
      severity: t("fields.severity"),
      chooseSeverity: t("fields.chooseSeverity"),
      affectedCount: t("fields.count"),
      personalDataInvolved: t("fields.personalData"),
      minorsAffected: t("fields.minors"),
      impact: t("fields.impact"),
    },
    errors: {
      title: t("fieldErrors.title"),
      awareAt: t("fieldErrors.awareAt"),
      severity: t("fieldErrors.severity"),
      affectedCount: t("fieldErrors.affectedCount"),
      personalDataInvolved: t("errors.invalid_input"),
      minorsAffected: t("errors.invalid_input"),
      impact: t("fieldErrors.impact"),
    },
    severities: {
      critical: t("severities.critical"),
      high: t("severities.high"),
      medium: t("severities.medium"),
      low: t("severities.low"),
    },
  };
}
