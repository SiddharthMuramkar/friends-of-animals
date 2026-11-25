"use server";

import { updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { adminDirectoryListingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import type { Actor } from "@/server/actor";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import {
  DIRECTORY_TAGS,
  type DecideListingResult,
} from "@/server/modules/directory";

import {
  afterDecision,
  decisionFrom,
  type DecisionFormState,
} from "./decision-state";

async function signedIn(): Promise<Actor> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** Sends a second-factor refusal to the page that lifts it, then `back`. */
function liftSecondFactor(error: unknown, back: string): void {
  if (!(error instanceof DomainError)) return;
  const path = secondFactorPath(error.code, back);
  if (path) redirect(path);
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Verifies, rejects, suspends or reinstates the listing (the pressed
 * button says which), refreshes its public page, then shows the review
 * page again with what happened. A problem with the reason comes back to
 * the form with what was typed.
 */
export async function decideListingAction(
  previous: DecisionFormState,
  formData: FormData
): Promise<DecisionFormState> {
  const actor = await signedIn();
  const input = decisionFrom(formData);
  if (!input) return afterDecision(previous, "", "unexpected");
  const back = adminDirectoryListingPath(input.listingId);
  const { listingId, reason } = input;
  let result: DecideListingResult;
  try {
    const app = as(actor);
    switch (input.decision) {
      case "verify":
        result = await app.verifyListing({ listingId, reason });
        break;
      case "reject":
        result = await app.rejectListing({ listingId, reason });
        break;
      case "suspend":
        result = await app.suspendListing({ listingId, reason });
        break;
      case "reinstate":
        result = await app.reinstateListing({ listingId, reason });
        break;
    }
  } catch (error) {
    liftSecondFactor(error, back);
    if (!(error instanceof DomainError)) {
      console.error(`decideListing failed: ${errorSummaryForLogs(error)}`);
    }
    return afterDecision(previous, reason, "unexpected");
  }
  if (!result.ok) return afterDecision(previous, reason, result);
  updateTag(DIRECTORY_TAGS.listing(result.slug));
  redirect(`${back}?decided=${result.outcome}`, RedirectType.replace);
}

/**
 * Opens one of the listing's documents through a short-lived signed link,
 * or comes back to the listing saying it can't.
 */
export async function openDocumentAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const listingId = text(formData, "listingId");
  const back = adminDirectoryListingPath(listingId);
  let destination = `${back}?document=unavailable`;
  try {
    const result = await as(actor).getListingDocumentUrl({
      documentId: text(formData, "documentId"),
    });
    if (result.ok) destination = result.url;
  } catch (error) {
    liftSecondFactor(error, back);
    if (!(error instanceof DomainError)) {
      console.error(
        `getListingDocumentUrl failed: ${errorSummaryForLogs(error)}`
      );
    }
  }
  redirect(destination);
}
