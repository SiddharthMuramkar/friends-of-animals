"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { DASHBOARD_INVITATIONS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import {
  INVITATION_ACTIONS,
  type InvitationAction,
} from "@/server/modules/invitations/actions";

export async function acceptAction(invitationId: string, data: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user")
    redirect(
      `${ROUTES.signIn.path}?next=${encodeURIComponent(DASHBOARD_INVITATIONS)}`
    );
  const action = data.get("action");
  if (
    typeof action !== "string" ||
    !(INVITATION_ACTIONS as readonly string[]).includes(action)
  )
    redirect(`${DASHBOARD_INVITATIONS}?result=unavailable`);
  let result;
  try {
    result = await as(actor).acceptCompetitionInvitation({
      invitationId,
      action: action as InvitationAction,
    });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    redirect(`${DASHBOARD_INVITATIONS}?result=unavailable`);
  }
  redirect(
    result.ok
      ? result.destination
      : `${DASHBOARD_INVITATIONS}?result=unavailable`
  );
}
