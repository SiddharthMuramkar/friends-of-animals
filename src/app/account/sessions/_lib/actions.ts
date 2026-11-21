"use server";

import { redirect, RedirectType } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

/**
 * Signs one session out; this browser's own sends it to sign in. Another
 * device's comes back to the list with `?signedOut=<token>`, so the page
 * says it worked and moves focus there. The token is new each time, so a
 * second sign-out is announced too. A session that was already gone (not
 * found) just comes back to the list: nothing was signed out.
 */
export async function signOutSessionAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const sessionId = formData.get("sessionId");
  const result = await as(actor).signOutSession({
    sessionId: typeof sessionId === "string" ? sessionId : "",
  });
  if (result.ok && result.signedOutHere) redirect(ROUTES.signIn.path);
  if (!result.ok) redirect(APP_ROUTES.accountSessions, RedirectType.replace);
  const token = Date.now().toString(36);
  redirect(
    `${APP_ROUTES.accountSessions}?signedOut=${token}`,
    RedirectType.replace
  );
}

/** Signs every session out, this one too, then goes to sign in. */
export async function signOutEverywhereAction(): Promise<void> {
  const actor = await currentActor();
  if (actor.kind === "user") await as(actor).signOutEverywhere();
  redirect(ROUTES.signIn.path);
}
