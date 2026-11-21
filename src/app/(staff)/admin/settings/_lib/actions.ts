"use server";

import { getTranslations } from "next-intl/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { isSettingKey, SETTINGS } from "@/server/settings/catalogue";
import { settingValueFromForm } from "@/server/settings/form";

import { afterChange, afterError, type SettingFormState } from "./form-state";

/** The form's state plus its words, translated here on the server. */
export type SettingFormView = SettingFormState & { message?: string };

async function withMessage(
  state: SettingFormState,
  kind: "boolean" | "integer"
): Promise<SettingFormView> {
  const t = await getTranslations("adminSettings");
  switch (state.status) {
    case "idle":
      return state;
    case "saved":
    case "unchanged":
      return { ...state, message: t(`result.${state.status}`) };
    case "invalid": {
      const { problem } = state;
      const message =
        problem.reason === "too_small"
          ? t("errors.too_small", { min: problem.min })
          : problem.reason === "too_big"
            ? t("errors.too_big", { max: problem.max })
            : t("errors.wrong_type", { kind });
      return { ...state, message };
    }
    case "refused":
      return { ...state, message: t(`errors.${state.reason}`) };
  }
}

/**
 * Saves one setting from its form: `key`, and `value` as the form field
 * for the setting's input. changeSetting checks who may (a super admin,
 * with a fresh second factor) and the value; this only turns the field
 * into a typed value and the result into words. A stored value refreshes
 * the page, so every setting shows what applies now.
 */
export async function changeSettingAction(
  _previous: SettingFormView,
  formData: FormData
): Promise<SettingFormView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const key = formData.get("key");
  const field = formData.get("value");
  const entered = typeof field === "string" ? field : "";
  const known = typeof key === "string" && isSettingKey(key) ? key : null;
  const kind = known ? SETTINGS[known].input.kind : "integer";

  let state: SettingFormState;
  try {
    const result = await as(actor).changeSetting({
      key: typeof key === "string" ? key : "",
      value: known ? settingValueFromForm(known, field) : field,
    });
    state = afterChange(result, entered);
  } catch (error) {
    state = afterError(error);
    if (state.status === "refused" && state.reason === "failed") {
      console.error("changeSettingAction:", errorSummaryForLogs(error));
    }
  }
  if (state.status === "saved") refresh();
  return withMessage(state, kind);
}
