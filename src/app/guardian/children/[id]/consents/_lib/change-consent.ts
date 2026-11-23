import { randomUUID } from "node:crypto";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { guardianChildConsentsPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import type { Actor } from "@/server/actor";
import type { App } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  giveChildConsentInput,
  withdrawChildConsentInput,
} from "@/server/modules/consent";

const changeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("give"), input: giveChildConsentInput }),
  z.object({ kind: z.literal("withdraw"), input: withdrawChildConsentInput }),
]);

export async function changeConsent(
  app: App & { currentActor(): Promise<Actor> },
  change: { kind: "give" | "withdraw"; input: unknown }
) {
  const actor = await app.currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const parsed = changeInput.safeParse(change);
  if (!parsed.success) notFound();
  const { kind, input } = parsed.data;
  const consent = app.as(actor);
  let done;
  try {
    const result =
      kind === "give"
        ? await consent.giveChildConsent(input)
        : await consent.withdrawChildConsent(input);
    done = result.ok
      ? kind === "give"
        ? "given"
        : "withdrawn"
      : result.error === "document_outdated"
        ? result.error
        : "failed";
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") notFound();
    throw error;
  }
  redirect(
    `${guardianChildConsentsPath(input.childId)}?${new URLSearchParams({ done, n: randomUUID() })}`
  );
}
