"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { NO_NOTICE, type SignOutState } from "./sign-out-state";

/**
 * Signs one session out; this browser's own sends it to sign in. For
 * another device's, `refresh()` re-renders the list without it in the same
 * response, and the page's state gets a new notice id, so the page says
 * it worked and moves focus there. A session that was already gone (not
 * found) leaves the list with nothing to say: nothing was signed out.
 */
export async function signOutSessionAction(
  _previous: SignOutState,
  formData: FormData
): Promise<SignOutState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const sessionId = formData.get("sessionId");
  const result = await as(actor).signOutSession({
    sessionId: typeof sessionId === "string" ? sessionId : "",
  });
  if (result.ok && result.signedOutHere) redirect(ROUTES.signIn.path);
  refresh();
  return result.ok ? { noticeId: crypto.randomUUID() } : NO_NOTICE;
}

/** Signs every session out, this one too, then goes to sign in. */
export async function signOutEverywhereAction(): Promise<void> {
  const actor = await currentActor();
  if (actor.kind === "user") await as(actor).signOutEverywhere();
  redirect(ROUTES.signIn.path);
}
