"use server";

import { redirect, RedirectType } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

/**
 * Marks one of the user's inbox items read, then shows the inbox again (and
 * the header's unread count with it). Another user's item is "not found"
 * and changes nothing.
 */
export async function markInboxItemReadAction(
  formData: FormData
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const id = formData.get("id");
  await as(actor).markInboxItemRead({ id: typeof id === "string" ? id : "" });
  redirect(APP_ROUTES.accountInbox, RedirectType.replace);
}

/** Marks every unread item read, then shows the inbox again. */
export async function markAllInboxReadAction(): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  await as(actor).markAllInboxRead();
  redirect(APP_ROUTES.accountInbox, RedirectType.replace);
}
