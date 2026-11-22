"use server";

import { redirect, RedirectType } from "next/navigation";

import { invitationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

/**
 * Accepts the invitation behind `token` (bound by the page) and comes back
 * to its page, which then shows the outcome: accepted, or why not
 * (`?error=<reason>`).
 */
export async function acceptInvitationAction(token: string): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).acceptInvitation({ token });
  const page = invitationPath(token);
  redirect(
    result.ok ? page : `${page}?error=${result.error}`,
    RedirectType.replace
  );
}
