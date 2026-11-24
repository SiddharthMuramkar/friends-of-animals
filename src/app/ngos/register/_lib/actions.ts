"use server";

import { redirect } from "next/navigation";

import {
  afterResult,
  detailsFrom,
  valuesFrom,
  type ListingFormState,
} from "@/components/directory/listing-form-state";
import { myListingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { RegisterListingResult } from "@/server/modules/directory";

/**
 * Registers the listing, then shows the person its page, where they upload
 * their proof. A refused field or an open listing comes back to the form
 * with what was typed.
 */
export async function registerListingAction(
  previous: ListingFormState,
  formData: FormData
): Promise<ListingFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const values = valuesFrom(formData);
  let result: RegisterListingResult;
  try {
    result = await as(actor).registerListing(detailsFrom(values));
  } catch (error) {
    console.error(`registerListing failed: ${errorSummaryForLogs(error)}`);
    return afterResult(previous, values, "unexpected");
  }
  if (result.ok) redirect(`${myListingPath(result.listingId)}?registered=1`);
  return afterResult(previous, values, result);
}
