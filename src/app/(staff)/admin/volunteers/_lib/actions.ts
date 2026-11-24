"use server";

import { getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import { adminVolunteerApplicationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { adminCall } from "../../_lib/boundary";
import { refusedState, type DecisionState } from "./form-state";

// The community team's decisions on a volunteer application (#123). Each
// calls one use case, which authorizes (community managers and super
// admins, with this session's second factor; approving asks for a fresh
// one) and checks the input. A second-factor refusal goes to the page that
// lifts it, then back to the application. A decision goes back to the
// application, saying what was done (`done`): its forms are gone then. A
// refusal comes back to the form in words, with the reason typed.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function decided(applicationId: string, done: "approved" | "declined"): never {
  const query = new URLSearchParams({ done, n: Date.now().toString(36) });
  redirect(
    `${adminVolunteerApplicationPath(applicationId)}?${query.toString()}`,
    RedirectType.replace
  );
}

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

export async function approveAction(
  _previous: DecisionState,
  formData: FormData
): Promise<DecisionState> {
  const actor = await signedIn();
  const applicationId = field(formData, "applicationId");
  const t = await getTranslations("adminVolunteers.detail.approve");
  const outcome = await adminCall(
    () => as(actor).approveVolunteer({ applicationId }),
    adminVolunteerApplicationPath(applicationId)
  );
  if (!outcome.ok) {
    return { status: "refused", message: t("forbidden"), typed: "" };
  }
  const result = outcome.value;
  if (result.ok) decided(applicationId, "approved");
  return refusedState(
    // An id that isn't one is no application.
    result.error === "invalid_input" ? "not_found" : result.error,
    {
      not_found: t("refused.not_found"),
      invalid_transition: t("refused.invalid_transition"),
      safeguarding_declaration_unpublished: t("refused.unpublished"),
      safeguarding_declaration_missing: t("refused.safeguarding_missing"),
      safeguarding_declaration_outdated: t("refused.safeguarding_outdated"),
      code_of_conduct_unpublished: t("refused.unpublished"),
      code_of_conduct_missing: t("refused.conduct_missing"),
      code_of_conduct_outdated: t("refused.conduct_outdated"),
    }
  );
}

export async function declineAction(
  _previous: DecisionState,
  formData: FormData
): Promise<DecisionState> {
  const actor = await signedIn();
  const applicationId = field(formData, "applicationId");
  const reason = field(formData, "reason");
  const t = await getTranslations("adminVolunteers.detail.decline");
  const outcome = await adminCall(
    () => as(actor).declineVolunteer({ applicationId, reason }),
    adminVolunteerApplicationPath(applicationId)
  );
  if (!outcome.ok) {
    return { status: "refused", message: t("forbidden"), typed: reason };
  }
  const result = outcome.value;
  if (result.ok) decided(applicationId, "declined");
  return refusedState(
    result.error,
    {
      not_found: t("refused.not_found"),
      invalid_input: t("refused.invalid_input"),
      invalid_transition: t("refused.invalid_transition"),
    },
    reason
  );
}
