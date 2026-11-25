"use server";

import { redirect, RedirectType } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { OwnPublicPurpose } from "@/server/modules/consent/own-public-use";

import { noticeAfterGive, type ConsentNotice } from "./notice";

/**
 * Back to the consent page with `?done=<what>-<token>`, so it says what
 * happened and moves focus there. The token is new each time, so the
 * same notice twice is announced twice.
 */
function backWith(done: ConsentNotice): never {
  const token = crypto.randomUUID().slice(0, 8);
  redirect(
    `${APP_ROUTES.accountConsents}?done=${done}-${token}`,
    RedirectType.replace
  );
}

/**
 * Gives consent to news and updates, on the version the page showed. If
 * staff published a new one meanwhile, nothing is recorded and the page
 * shows the new text.
 */
export async function giveConsentAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const documentId = formData.get("documentId");
  const result = await as(actor).giveConsent({
    purpose: "messages",
    documentId: typeof documentId === "string" ? documentId : "",
  });
  backWith(noticeAfterGive(result));
}

/** Withdraws consent to news and updates. */
export async function withdrawConsentAction(): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).withdrawConsent({ purpose: "messages" });
  backWith(result.ok ? "withdrawn" : "failed");
}

export async function giveAuctionConsentAction(
  competitionId: string,
  formData: FormData
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const documentId = formData.get("documentId");
  const result = await as(actor).giveMyAuctionConsent({
    competitionId,
    documentId: typeof documentId === "string" ? documentId : "",
  });
  backWith(
    result.ok
      ? "given"
      : result.error === "document_outdated"
        ? "outdated"
        : "failed"
  );
}

export async function withdrawAuctionConsentAction(
  competitionId: string
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).withdrawMyAuctionConsent({ competitionId });
  backWith(result.ok ? "withdrawn" : "failed");
}

export async function withdrawPublicUseConsentAction(
  competitionId: string,
  purpose: OwnPublicPurpose
): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).withdrawMyPublicUseConsent({
    competitionId,
    purpose,
  });
  backWith(result.ok ? "publicationWithdrawn" : "failed");
}
