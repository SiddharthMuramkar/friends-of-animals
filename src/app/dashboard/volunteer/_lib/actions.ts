"use server";

import { redirect, RedirectType, unstable_rethrow } from "next/navigation";

import { DASHBOARD_VOLUNTEER } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";

import {
  applyInputOf,
  declarationsTicked,
  readApplyForm,
  refused,
  type ApplyState,
} from "./form-state";

// The member's volunteer forms (#123). Each calls one use case, which
// authorizes the signed-in member and checks the input. Applying comes back
// to the form after a refusal, with everything that was sent; the other
// forms post and come back to the page with what happened (`done`).

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Back to the page, saying what happened; a fresh `n` announces a repeat. */
function backWith(done: string): never {
  const query = new URLSearchParams({ done, n: Date.now().toString(36) });
  redirect(`${DASHBOARD_VOLUNTEER}?${query.toString()}`, RedirectType.replace);
}

export async function applyAction(
  _previous: ApplyState,
  formData: FormData
): Promise<ApplyState> {
  const actor = await signedIn();
  const values = readApplyForm(formData);
  if (!declarationsTicked(values)) {
    return refused(values, "declarations_required");
  }
  let status: "submitted" | "awaiting_guardian";
  try {
    const result = await as(actor).applyToVolunteer(applyInputOf(values));
    if (!result.ok) {
      return result.error === "invalid_input"
        ? refused(values, "invalid_input", result.fields)
        : refused(values, result.error);
    }
    status = result.status;
  } catch (error) {
    unstable_rethrow(error);
    // Only the error's class and Postgres code: its message can hold what
    // the member typed.
    console.error(
      `Volunteer application: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return refused(values, "unexpected");
  }
  backWith(status === "awaiting_guardian" ? "awaiting_guardian" : "applied");
}

/** Accepts the current versions of both declarations again. */
export async function acceptDeclarationsAction(
  formData: FormData
): Promise<void> {
  const actor = await signedIn();
  const safeguardingDocumentId = text(formData, "safeguardingDocumentId");
  const conductDocumentId = text(formData, "conductDocumentId");
  if (safeguardingDocumentId === "" || conductDocumentId === "") {
    backWith("declarations_required");
  }
  const result = await as(actor).acceptVolunteerDeclarations({
    safeguardingDocumentId,
    conductDocumentId,
  });
  backWith(result.ok ? "accepted" : result.error);
}

/** Withdraws the member's own open application. */
export async function withdrawAction(
  applicationId: string,
  _formData: FormData
): Promise<void> {
  const actor = await signedIn();
  const result = await as(actor).withdrawVolunteerApplication({
    applicationId,
  });
  backWith(result.ok ? "withdrawn" : result.error);
}
