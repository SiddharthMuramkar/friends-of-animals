"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

/**
 * Marks one of the user's inbox items read, then re-renders the whole
 * route, so the header's unread count (in the root layout) drops with the
 * list. A redirect to the inbox would re-render the page alone and keep
 * the layout's old count. Another user's item is "not found" and changes
 * nothing.
 */
export async function markInboxItemReadAction(
  formData: FormData
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const id = formData.get("id");
  await as(actor).markInboxItemRead({ id: typeof id === "string" ? id : "" });
  refresh();
}

/** Marks every unread item read, then re-renders the route, header too. */
export async function markAllInboxReadAction(): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  await as(actor).markAllInboxRead();
  refresh();
}
