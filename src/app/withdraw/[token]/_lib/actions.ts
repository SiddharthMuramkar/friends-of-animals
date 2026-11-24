"use server";

import { redirect, RedirectType } from "next/navigation";

import { withdrawalPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";

/**
 * Withdraws the consent the campaign message behind `token` (bound by the
 * page) was sent on, and comes back to its page, which then says it is
 * done. Whoever holds the link may, signed in or not (#126).
 */
export async function withdrawByLinkAction(token: string): Promise<void> {
  const actor = await currentActor();
  await as(actor).withdrawByLink({ token });
  redirect(withdrawalPath(token), RedirectType.replace);
}
