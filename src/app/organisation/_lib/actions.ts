"use server";

import { refresh, updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import {
  afterResult,
  detailsFrom,
  valuesFrom,
  type ListingFormState,
} from "@/components/directory/listing-form-state";
import { myListingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor, type UseCases } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { DIRECTORY_TAGS } from "@/server/modules/directory";
import { StorageNotConfiguredError } from "@/server/ports/storage";

import {
  afterWithdraw,
  withdrawFrom,
  type WithdrawFormState,
} from "./withdraw-state";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Saves the listing's details, then shows its page with what happened.
 * A refused field comes back to the form with what was typed.
 */
export async function updateListingAction(
  previous: ListingFormState,
  formData: FormData
): Promise<ListingFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const listingId = text(formData, "listingId");
  const values = valuesFrom(formData);
  let result;
  try {
    result = await as(actor).updateListing({
      ...detailsFrom(values),
      listingId,
    });
  } catch (error) {
    if (!(error instanceof DomainError)) {
      console.error(`updateListing failed: ${errorSummaryForLogs(error)}`);
    }
    return afterResult(previous, values, "unexpected");
  }
  if (!result.ok) return afterResult(previous, values, result);
  // The public page shows the change at once, or stops showing the
  // listing while FOA checks a new name.
  if (result.changed) updateTag(DIRECTORY_TAGS.listing(result.slug));
  const saved = !result.changed
    ? "unchanged"
    : result.resubmitted
      ? "resubmitted"
      : result.status === "verified"
        ? "saved"
        : "savedPending";
  redirect(`${myListingPath(listingId)}?saved=${saved}`, RedirectType.replace);
}

/** Withdraws the listing for good, then shows its page again. */
export async function withdrawListingAction(
  previous: WithdrawFormState,
  formData: FormData
): Promise<WithdrawFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const input = withdrawFrom(formData);
  let result;
  try {
    result = await as(actor).withdrawListing(input);
  } catch (error) {
    if (!(error instanceof DomainError)) {
      console.error(`withdrawListing failed: ${errorSummaryForLogs(error)}`);
    }
    return afterWithdraw(previous, input.reason ?? "", "unexpected");
  }
  if (!result.ok) return afterWithdraw(previous, input.reason ?? "", result);
  updateTag(DIRECTORY_TAGS.listing(result.slug));
  redirect(
    `${myListingPath(input.listingId)}?saved=withdrawn`,
    RedirectType.replace
  );
}

type UploadInput = Parameters<UseCases["requestListingDocumentUpload"]>[0];

/** Presigns one document's upload; the browser PUTs it, then completes. */
export async function requestListingDocumentUploadAction(input: UploadInput) {
  const actor = await currentActor();
  if (actor.kind !== "user") return { ok: false, error: "forbidden" } as const;
  try {
    return await as(actor).requestListingDocumentUpload(input);
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: "forbidden" } as const;
    }
    if (error instanceof StorageNotConfiguredError) {
      return { ok: false, error: "unexpected" } as const;
    }
    throw error;
  }
}

/** Shows the listing's page again once an upload has completed. */
export async function refreshListingAction() {
  refresh();
}
