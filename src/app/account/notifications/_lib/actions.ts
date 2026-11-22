"use server";

import { redirect, RedirectType } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

/**
 * Saves the user's channel choices and comes back with `?saved=<token>`
 * (new each time, so a second save is announced too), or `?error=both-off`
 * when both boxes were cleared.
 */
export async function savePreferencesAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).updateNotificationPreferences({
    email: formData.get("email") === "on",
    sms: formData.get("sms") === "on",
  });
  const query = result.ok
    ? `saved=${Date.now().toString(36)}`
    : "error=both-off";
  redirect(`${APP_ROUTES.accountNotifications}?${query}`, RedirectType.replace);
}
