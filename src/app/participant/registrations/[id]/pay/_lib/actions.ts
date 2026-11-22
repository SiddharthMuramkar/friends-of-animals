"use server";

import { redirect, RedirectType } from "next/navigation";

import { payMyRegistrationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { PayForMyRegistrationResult } from "@/server/modules/participants";

import { payOutcome } from "./pay-outcome";

/**
 * Pays for the signed-in adult's registration, then comes back to its pay
 * page saying what happened. The Checkout island (77b) opens the gateway's
 * checkout from there.
 */
export async function payForMyRegistrationAction(
  registrationId: string
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  let result: PayForMyRegistrationResult;
  try {
    result = await as(actor).payForMyRegistration({ registrationId });
  } catch (error) {
    console.error(`payForMyRegistration failed: ${errorSummaryForLogs(error)}`);
    result = { ok: false, error: "gateway_unavailable" };
  }
  const query = new URLSearchParams({
    done: payOutcome(result),
    n: Date.now().toString(36),
  });
  redirect(
    `${payMyRegistrationPath(registrationId)}?${query.toString()}`,
    RedirectType.replace
  );
}
