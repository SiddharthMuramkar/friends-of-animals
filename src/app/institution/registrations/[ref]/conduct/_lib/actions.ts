"use server";

import { redirect, RedirectType } from "next/navigation";

import { conductCertificationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";

import {
  conductError,
  conductOutcome,
  type ConductOutcome,
} from "./conduct-outcome";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Certifies the registration's conduct (#87), then goes back to the
 * conduct page saying what happened. certifyConduct checks who may.
 */
export async function certifyConductAction(formData: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const institutionId = field(formData, "institutionId");
  const reference = field(formData, "reference");
  let outcome: ConductOutcome;
  try {
    outcome = conductOutcome(
      await as(actor).certifyConduct({ institutionId, reference })
    );
  } catch (error) {
    outcome = conductError(error);
    if (outcome === "failed") {
      console.error(`certifyConduct failed: ${errorSummaryForLogs(error)}`);
    }
  }
  const query = new URLSearchParams({
    done: outcome,
    // New each time, so a second outcome in a row is announced too.
    n: Date.now().toString(36),
  });
  redirect(
    `${conductCertificationPath(reference, institutionId)}&${query.toString()}`,
    RedirectType.replace
  );
}
