import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ROUTES } from "@/lib/routes";
import { PATH_HEADER, secondFactorPath } from "@/lib/second-factor-routes";
import { as, currentActor } from "@/server/app";

/**
 * Staff pages open only for a signed-in user whose staff roles' second
 * factor is in order (#60): one without a factor is sent to enrol, one who
 * hasn't passed it in this session to pass it, each then back here.
 * Someone without a staff role passes; each page still checks its own
 * permission. Reads the session, so it renders under <Suspense>.
 *
 * A layout doesn't run again on client navigation and Server Actions can
 * be called directly, so every staff use case enforces the same rule
 * itself (can()); this only sends the user where they can go on.
 */
export async function StaffGate({ children }: { children: ReactNode }) {
  const [actor, requestHeaders] = await Promise.all([
    currentActor(),
    headers(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const access = await as(actor).staffAccess();
  if (!access.ok) {
    const here = requestHeaders.get(PATH_HEADER) ?? undefined;
    redirect(secondFactorPath(access.code, here) ?? ROUTES.signIn.path);
  }
  return children;
}
