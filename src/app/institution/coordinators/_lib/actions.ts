"use server";

import { getTranslations } from "next-intl/server";
import { refresh } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { InviteCoordinatorResult } from "@/server/modules/institutions/coordinators";

import {
  inviteFormState,
  removeOutcome,
  withdrawOutcome,
  type InviteFormState,
  type InviteFormView,
  type ManageOutcome,
} from "./invite-state";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Sends one invitation and returns what the form shows next, translated
 * here so the client island ships no message catalogue. Anything
 * unexpected (the database, or the same address invited twice at once)
 * keeps what was typed beside "Something went wrong".
 */
export async function inviteCoordinatorAction(
  _previous: InviteFormView,
  formData: FormData
): Promise<InviteFormView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const identifier = field(formData, "identifier");
  let result: InviteCoordinatorResult | undefined;
  try {
    result = await as(actor).inviteCoordinator({
      institutionId: field(formData, "institutionId"),
      identifier,
    });
  } catch (error) {
    console.error(`inviteCoordinator failed: ${errorSummaryForLogs(error)}`);
  }
  const state: InviteFormState = result
    ? inviteFormState(identifier, result)
    : { identifier, problem: "failed" };
  // The list of waiting invitations shows the new one at once.
  if (result?.ok) refresh();
  const t = await getTranslations("coordinators.manage");
  return {
    ...state,
    text: {
      sent: state.sentTo ? t("sent", { address: state.sentTo }) : undefined,
      problem: state.problem ? t(`errors.${state.problem}`) : undefined,
    },
  };
}

/**
 * Back to the list with what happened. `n` is new each time, so a second
 * outcome in a row is announced too.
 */
function backToList(institutionId: string, outcome: ManageOutcome): never {
  const query = new URLSearchParams({
    institution: institutionId,
    done: outcome,
    n: Date.now().toString(36),
  });
  redirect(
    `${APP_ROUTES.institutionCoordinators}?${query.toString()}`,
    RedirectType.replace
  );
}

export async function removeCoordinatorAction(
  formData: FormData
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const institutionId = field(formData, "institutionId");
  const result = await as(actor).removeCoordinator({
    institutionId,
    userId: field(formData, "userId"),
  });
  backToList(institutionId, removeOutcome(result));
}

export async function revokeInvitationAction(
  formData: FormData
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const institutionId = field(formData, "institutionId");
  const result = await as(actor).revokeInvitation({
    institutionId,
    invitationId: field(formData, "invitationId"),
  });
  backToList(institutionId, withdrawOutcome(result));
}
