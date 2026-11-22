"use server";

import { refresh } from "next/cache";
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

/**
 * Accepts a teen-login invitation (#81) behind `token` and comes back to
 * its page, which then shows the outcome.
 */
export async function acceptTeenInvitationAction(token: string): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).acceptTeenInvitation({ token });
  const page = invitationPath(token);
  if (result.ok) {
    // Re-renders the header for the newly linked login.
    refresh();
    redirect(page, RedirectType.replace);
  }
  redirect(`${page}?error=${result.error}`, RedirectType.replace);
}

/**
 * Accepts a teen's guardian request (81b) behind `token`, as their parent
 * or guardian, and comes back to its page, which then shows the outcome.
 */
export async function acceptGuardianRequestAction(
  token: string,
  formData: FormData
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const relationship = formData.get("relationship");
  const result = await as(actor).acceptGuardianRequest({
    token,
    relationship: typeof relationship === "string" ? relationship : "",
  });
  const page = invitationPath(token);
  if (result.ok) {
    // Re-renders the header: the guardian now has a child's registration.
    refresh();
    redirect(page, RedirectType.replace);
  }
  redirect(`${page}?error=${result.error}`, RedirectType.replace);
}
