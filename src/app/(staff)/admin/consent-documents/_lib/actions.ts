"use server";

import { getTranslations } from "next-intl/server";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { consentDocumentTag } from "@/server/consent/cached";
import {
  CONSENT_PURPOSES,
  type ConsentPurpose,
} from "@/server/consent/domain/purposes";
import { errorSummaryForLogs } from "@/server/errors";

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

function isPurpose(value: string): value is ConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(value);
}

/**
 * The publish form's one action. `intent` (from the pressed button) says
 * what to do: preview the source, or publish it as the next version.
 * Publishing refreshes the cached current version, then goes back to the
 * page, which lists the new version and says so.
 */
export async function publishFormAction(
  _previous: PublishFormView | null,
  formData: FormData
): Promise<PublishFormView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const purpose = field(formData, "purpose");
  const entered = {
    title: field(formData, "title"),
    source: field(formData, "source"),
  };
  if (!isPurpose(purpose)) return withText({ ...entered, alert: "failed" });

  let version: number;
  try {
    if (field(formData, "intent") !== "publish") {
      const preview = await as(actor).previewConsentDocument({
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
    console.error(
      `Consent document form: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return withText({ ...entered, alert: "failed" });
  }
  updateTag(consentDocumentTag(purpose));
  const token = Date.now().toString(36);
  redirect(
    `${APP_ROUTES.adminConsentDocuments}?published=${purpose}-${version}-${token}`
  );
}
