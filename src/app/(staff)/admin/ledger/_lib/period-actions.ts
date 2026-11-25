"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import {
  ADMIN_LEDGER,
  ADMIN_LEDGER_APPROVALS,
  ADMIN_LEDGER_PERIODS,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor, type UseCases } from "@/server/app";

import { adminCall } from "../../_lib/boundary";
import { periodOutcomeHref, type PeriodOutcome } from "./period-outcome";

// Period locks and two-approver decisions (#109). Each use case authorizes
// itself; only an outcome code travels back in the address, never the
// reason finance typed.

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function act(
  path: string,
  run: (use: UseCases) => Promise<PeriodOutcome>
): Promise<never> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const call = await adminCall(() => run(as(actor)), path);
  revalidatePath(ADMIN_LEDGER_PERIODS);
  revalidatePath(ADMIN_LEDGER_APPROVALS);
  revalidatePath(ADMIN_LEDGER);
  redirect(
    periodOutcomeHref(path, call.ok ? call.value : { error: "forbidden" }),
    RedirectType.replace
  );
}

const outcome = (
  result: { ok: true } | { ok: false; error: string },
  done: Extract<PeriodOutcome, { done: string }>["done"]
): PeriodOutcome => (result.ok ? { done } : { error: result.error });

export async function requestLockAction(formData: FormData) {
  await act(ADMIN_LEDGER_PERIODS, async (use) =>
    outcome(
      await use.requestPeriodLock({ month: text(formData, "month") }),
      "lock_requested"
    )
  );
}

export async function requestUnlockAction(formData: FormData) {
  await act(ADMIN_LEDGER_PERIODS, async (use) =>
    outcome(
      await use.requestPeriodUnlock({
        month: text(formData, "month"),
        reason: text(formData, "reason"),
      }),
      "unlock_requested"
    )
  );
}

export async function approveRequestAction(formData: FormData) {
  await act(ADMIN_LEDGER_APPROVALS, async (use) =>
    outcome(
      await use.approveFinanceRequest({
        requestId: text(formData, "requestId"),
      }),
      "approved"
    )
  );
}

export async function rejectRequestAction(formData: FormData) {
  await act(ADMIN_LEDGER_APPROVALS, async (use) =>
    outcome(
      await use.rejectFinanceRequest({
        requestId: text(formData, "requestId"),
        reason: text(formData, "reason"),
      }),
      "rejected"
    )
  );
}

export async function cancelRequestAction(formData: FormData) {
  await act(ADMIN_LEDGER_APPROVALS, async (use) =>
    outcome(
      await use.cancelFinanceRequest({
        requestId: text(formData, "requestId"),
      }),
      "cancelled"
    )
  );
}
