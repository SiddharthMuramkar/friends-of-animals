// What the second-factor server actions (here and on /account/security)
// read before calling a use case: the signed-in user, or a redirect to sign
// in, and a form field as text.

import "server-only";

import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { currentActor } from "@/server/app";

/** The signed-in user; anyone else goes to sign in. */
export async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** A form field's text, or "" when it's missing or a file. */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
