"use server";

import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { getTranslations } from "next-intl/server";
import {
  monthlyCheckoutPath,
  recurringDonationPath,
  ADMIN_RECURRING_DONATIONS,
} from "@/lib/app-routes";
import { revalidatePath } from "next/cache";
import { errorSummaryForLogs } from "@/server/errors";

export type StartState = { error?: string };
export async function startMonthlyAction(
  _state: StartState,
  form: FormData
): Promise<StartState> {
  const t = await getTranslations("donorDashboard.errors");
  const amount = form.get("amount");
  if (typeof amount !== "string" || !/^\d{1,6}$/.test(amount))
    return { error: t("invalid_input") };
  let result;
  try {
    result = await as(await currentActor()).startRecurringDonation({
      amountMinor: BigInt(amount) * 100n,
      showOnWall: form.has("wall"),
      declaredAdult: form.has("adult"),
      declaredIndianSource: form.has("indian"),
    });
  } catch (error) {
    console.error("Start monthly donation:", errorSummaryForLogs(error));
    return { error: t("generic") };
  }
  if (!result.ok) return { error: t(result.error) };
  redirect(monthlyCheckoutPath(result.id));
}

export async function cancelMonthlyAction(id: string) {
  const result = await as(await currentActor()).cancelRecurringDonation({ id });
  if (!result.ok) return;
  revalidatePath(recurringDonationPath(id));
  revalidatePath(ADMIN_RECURRING_DONATIONS);
}

export async function reissueMonthlyReceiptAction(donationId: string) {
  await as(await currentActor()).reissueReceiptLink({ donationId });
}
