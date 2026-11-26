import "server-only";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { ROUTES } from "@/lib/routes";
import { DASHBOARD_VOLUNTEER } from "@/lib/app-routes";
export async function ownVolunteerRecord() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await as(actor).getMyVolunteerRecord();
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden")
      redirect(DASHBOARD_VOLUNTEER);
    throw e;
  }
}
