"use server";

import { as, currentActor } from "@/server/app";

import { changeConsent } from "./_lib/change-consent";

const app = { as, currentActor };

export async function giveChildConsentAction(input: unknown) {
  await changeConsent(app, { kind: "give", input });
}

export async function withdrawChildConsentAction(input: unknown) {
  await changeConsent(app, { kind: "withdraw", input });
}
