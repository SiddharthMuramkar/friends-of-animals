"use server";

import { getTranslations } from "next-intl/server";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { consentDocumentTag } from "@/server/modules/consent/cached";
import { DOCUMENT_PURPOSES } from "@/server/modules/consent/domain/purposes";

import {
  afterPreview,
  afterPublishRefused,
  type PublishFormState,
  type PublishFormView,
} from "./publish-state";

async function withText(state: PublishFormState): Promise<PublishFormView> {
  const t = await getTranslations("consentAdmin.form");
  return {
    ...state,
    text: {
      alert: state.alert ? t(state.alert) : undefined,
      title: state.titleError ? t("title.error") : undefined,
      sourceErrors: (state.sourceErrors ?? []).map(({ line, code }) =>
        line === null
          ? t(`errors.${code}`)
          : t("lineError", { line, message: t(`errors.${code}`) })
      ),
    },
  };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The publish form's one action. `intent` (from the pressed button) says
 * what to do: preview the source, or publish it as the next version.
 * Publishing refreshes the cached current version, then goes back to the
 * page, which lists the new version and says so. The privacy notice and
 * the terms are their policy pages' text: only publishing the page in the
 * CMS publishes them (#111), so the page offers no form for them and the
 * use cases refuse them.
 */
export async function publishFormAction(
  _previous: PublishFormView | null,
  formData: FormData
): Promise<PublishFormView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const selectedPurpose = field(formData, "purpose");
  const purpose = DOCUMENT_PURPOSES.find(
    (choice) => choice === selectedPurpose
  );
  const entered = {
    title: field(formData, "title"),
    source: field(formData, "source"),
  };
  if (!purpose) return withText({ ...entered, alert: "failed" });

  let version: number;
  try {
    if (field(formData, "intent") !== "publish") {
      const preview = await as(actor).previewConsentDocument({
        purpose,
        source: entered.source,
      });
      return withText(afterPreview(preview, entered));
    }
    const result = await as(actor).publishConsentDocument({
      purpose,
      ...entered,
    });
    if (!result.ok) return withText(afterPublishRefused(result, entered));
    version = result.version;
  } catch (error) {
    if (error instanceof DomainError) {
      const path = secondFactorPath(
        error.code,
        APP_ROUTES.adminConsentDocuments
      );
      if (path) redirect(path);
    }
    console.error(
      `Consent document form: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return withText({ ...entered, alert: "failed" });
  }
  updateTag(consentDocumentTag(purpose));
  const token = crypto.randomUUID().slice(0, 8);
  redirect(
    `${APP_ROUTES.adminConsentDocuments}?published=${purpose}-${version}-${token}`
  );
}
