"use server";

import { redirect, RedirectType } from "next/navigation";

import { guardianChildVolunteerPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

// A guardian's answers to their teen's volunteer application (#123). Each
// calls one use case, which checks the guardian is verified and linked to
// the teen, then comes back to the page with what happened (`done`).

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function backWith(childId: string, done: string): never {
  const query = new URLSearchParams({ done, n: Date.now().toString(36) });
  redirect(
    `${guardianChildVolunteerPath(childId)}?${query.toString()}`,
    RedirectType.replace
  );
}

/** Approves or declines, by the button pressed (`decision`). */
export async function guardianDecideAction(
  childId: string,
  applicationId: string,
  formData: FormData
): Promise<void> {
  const actor = await signedIn();
  const decision =
    formData.get("decision") === "approve" ? "approve" : "decline";
  const result = await as(actor).decideAsGuardian({ applicationId, decision });
  backWith(
    childId,
    result.ok
      ? result.status === "submitted"
        ? "approved"
        : "declined"
      : result.error
  );
}

export async function guardianWithdrawAction(
  childId: string,
  applicationId: string,
  _formData: FormData
): Promise<void> {
  const actor = await signedIn();
  const result = await as(actor).withdrawVolunteerApplication({
    applicationId,
  });
  backWith(childId, result.ok ? "withdrawn" : result.error);
}
