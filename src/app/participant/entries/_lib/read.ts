import { notFound, redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor, type UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";

export async function readParticipantEntries<T>(
  read: (app: UseCases) => Promise<T>
) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await read(as(actor));
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") notFound();
    throw error;
  }
}
