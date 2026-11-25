"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import {
  ADMIN_LEDGER_BUDGET_REPORT,
  ADMIN_LEDGER_BUDGETS,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { adminCall } from "../../_lib/boundary";
import { budgetOutcomeHref } from "./report-outcome";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Sets one category's budget for one month (#109); the use case authorizes. */
export async function setBudgetAction(formData: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const back: Record<string, string> = {};
  const fy = text(formData, "fy");
  if (/^\d{4}$/.test(fy)) back.fy = fy;
  const call = await adminCall(
    () =>
      as(actor).setBudget({
        accountCode: text(formData, "accountCode"),
        periodMonth: text(formData, "periodMonth"),
        amount: text(formData, "amount"),
      }),
    ADMIN_LEDGER_BUDGETS
  );
  revalidatePath(ADMIN_LEDGER_BUDGETS);
  revalidatePath(ADMIN_LEDGER_BUDGET_REPORT);
  const outcome = !call.ok
    ? { error: "forbidden" }
    : call.value.ok
      ? ({ done: "budget_saved" } as const)
      : { error: call.value.error };
  redirect(
    budgetOutcomeHref(ADMIN_LEDGER_BUDGETS, back, outcome),
    RedirectType.replace
  );
}
