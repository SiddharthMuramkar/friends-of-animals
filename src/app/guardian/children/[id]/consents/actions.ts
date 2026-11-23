"use server";

import { randomUUID } from "node:crypto";

import { notFound, redirect } from "next/navigation";

import { guardianChildConsentsPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type {
  GiveChildConsentInput,
  WithdrawChildConsentInput,
} from "@/server/modules/consent";

type Change =
  | { kind: "give"; input: GiveChildConsentInput }
  | { kind: "withdraw"; input: WithdrawChildConsentInput };

async function changeConsent({ kind, input }: Change) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const consent = as(actor);
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

export async function giveChildConsentAction(input: GiveChildConsentInput) {
  await changeConsent({ kind: "give", input });
}

export async function withdrawChildConsentAction(
  input: WithdrawChildConsentInput
) {
  await changeConsent({ kind: "withdraw", input });
}
