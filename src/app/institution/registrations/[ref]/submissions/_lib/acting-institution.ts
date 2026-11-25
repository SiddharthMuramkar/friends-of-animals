import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import {
  actingInstitutions,
  chooseInstitution,
} from "../../../../competitions/_lib/register-state";

/**
 * The signed-in user's use cases and the institution they act for on a
 * registration's submission and conduct pages (#87): the one in the
 * address if they act for it, else their only one. Sends a visitor to sign
 * in.
 */
export async function actingFor(institution: string | string[] | undefined) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const app = as(actor);
  const { grants } = await app.myAccess();
  const institutionId = chooseInstitution(
    actingInstitutions(grants),
    typeof institution === "string" ? institution : undefined
  );
  return { app, institutionId };
}
