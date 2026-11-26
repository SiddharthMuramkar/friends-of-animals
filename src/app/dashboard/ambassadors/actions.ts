"use server";
import { redirect, RedirectType } from "next/navigation";
import { DASHBOARD_AMBASSADORS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";

export async function applyAmbassadorAction() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  let done: string;
  try {
    const result = await as(actor).applyForAmbassador();
    done = result.ok ? "submitted" : result.error;
  } catch (error) {
    if (error instanceof DomainError) done = "forbidden";
    else
      throw new Error(
        `Ambassador application failed: ${errorSummaryForLogs(error)}`
      );
  }
  redirect(
    `${DASHBOARD_AMBASSADORS}?${new URLSearchParams({ done, n: Date.now().toString(36) })}`,
    RedirectType.replace
  );
}
