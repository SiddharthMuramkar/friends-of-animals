"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ADMIN_PRIVACY } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor, type UseCases } from "@/server/app";
import { invalidInput } from "@/server/input";
import {
  placeLegalHoldInput,
  releaseLegalHoldInput,
} from "@/server/modules/privacy/hold-input";

import { adminCall } from "../../_lib/boundary";

export type HoldFormState = { ok: boolean; message: string } | null;

type HoldResult = Awaited<
  ReturnType<UseCases["placeLegalHold"] | UseCases["releaseLegalHold"]>
>;

async function changeHold(
  change: (app: UseCases) => Promise<HoldResult>,
  success: "placed" | "released"
): Promise<HoldFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await adminCall(() => change(as(actor)), ADMIN_PRIVACY);
  const t = await getTranslations("adminPrivacy.holds.form");
  if (!result.ok) return { ok: false, message: t("forbidden") };
  if (!result.value.ok) return { ok: false, message: t(result.value.error) };
  refresh();
  return { ok: true, message: t(success) };
}

export async function placeHoldAction(
  _previous: HoldFormState,
  form: FormData
): Promise<HoldFormState> {
  return changeHold(async (app) => {
    const parsed = placeLegalHoldInput.safeParse({
      subjectType: form.get("subjectType"),
      subjectId: form.get("subjectId"),
      reason: form.get("reason"),
    });
    if (!parsed.success) return invalidInput(parsed.error);
    return app.placeLegalHold(parsed.data);
  }, "placed");
}

export async function releaseHoldAction(
  _previous: HoldFormState,
  form: FormData
): Promise<HoldFormState> {
  return changeHold(async (app) => {
    const parsed = releaseLegalHoldInput.safeParse({
      holdId: form.get("holdId"),
    });
    if (!parsed.success) return invalidInput(parsed.error);
    return app.releaseLegalHold(parsed.data);
  }, "released");
}
