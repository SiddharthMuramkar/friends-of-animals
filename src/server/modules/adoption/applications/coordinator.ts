// The adoption coordinator's moves on an application (#130), through the
// one writer (./move.ts):
//
//   startAdoptionReview     submitted → under_review
//   putAdopterInContact     under_review → in_contact: the listing
//                           organisation sees the applicant's contact from
//                           now (audited as adoption.contact_shared)
//   recordAdoptionOutcome   adopted (from in_contact): the animal's listing
//                           closes as adopted (#129's writer) and every
//                           other open application on it closes, all in one
//                           transaction; not_matched or declined, with a
//                           reason staff keep
//
// A coordinator acts globally, or for the organisations of their
// organisation-scoped grants. Each move returns the animal's slug, so the
// Server Action can refresh the public pages. Loads under plain Node.

import { z } from "zod";

import { authorize } from "../../../access/can";
import type { Role } from "../../../access/domain/roles";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type {
  AdoptionApplicationAction,
  AdoptionApplicationStatus,
  AdoptionApplicationTransitionRefusal,
} from "../domain/application-status";
import { transitionAdoptionListing } from "../transition";
import { closeOpenApplications } from "./closure";
import { adopterConsentGiven } from "./consents";
import { moveApplication } from "./move";
import {
  applicationWithListing,
  organisationScope,
  refused,
  type ApplicationWithListing,
} from "./record";

export type CoordinatorMoveResult =
  | {
      ok: true;
      status: AdoptionApplicationStatus;
      slug: string;
      directoryListingId: string;
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | AdoptionApplicationTransitionRefusal
        | "sharing_consent_missing"
        | "listing_not_open";
    };

const idInput = z.object({ applicationId: z.uuid() });

/** The application, locked, if the coordinator may move it; throws otherwise. */
async function lockedForCoordinator(
  ctx: UseCaseContext,
  tx: UseCaseContext["db"],
  applicationId: string
): Promise<{ found: ApplicationWithListing; role: Role | null }> {
  const found = await applicationWithListing(tx, applicationId, {
    lock: true,
  });
  if (!found) refused(ctx, "adoption.application.move");
  const { role } = await authorize(
    { ...ctx, db: tx },
    "adoption.application.move",
    organisationScope(found.listing.directoryListingId)
  );
  return { found, role };
}

async function coordinatorMove(
  ctx: UseCaseContext,
  input: { applicationId: string; reason?: string | null },
  action: AdoptionApplicationAction,
  before?: (
    tx: UseCaseContext["db"],
    found: ApplicationWithListing
  ) => Promise<CoordinatorMoveResult | null>
): Promise<CoordinatorMoveResult> {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const { found, role } = await lockedForCoordinator(
      ctx,
      tx,
      parsed.data.applicationId
    );
    const early = before ? await before(tx, found) : null;
    if (early) return early;
    const moved = await moveApplication(ctx, tx, {
      application: found.application,
      action,
      actor: "coordinator",
      reason: input.reason ?? null,
      actorRole: role,
    });
    if (!moved.ok) return moved;
    if (moved.closesListing) {
      const listing = await transitionAdoptionListing(ctx, tx, {
        listingId: found.listing.id,
        to: "adopted",
        by: "coordinator",
        actorRole: role,
      });
      if (!listing.ok) {
        // Nothing of this move may stand: roll the transaction back.
        throw new ListingNotOpen();
      }
      await closeOpenApplications(ctx, tx, {
        listingId: found.listing.id,
        actorRole: role,
      });
    }
    return {
      ok: true,
      status: moved.to,
      slug: found.listing.slug,
      directoryListingId: found.listing.directoryListingId,
    } as const;
  });
}

class ListingNotOpen extends Error {}

async function catchListingNotOpen(
  run: Promise<CoordinatorMoveResult>
): Promise<CoordinatorMoveResult> {
  try {
    return await run;
  } catch (error) {
    if (error instanceof ListingNotOpen) {
      return { ok: false, error: "listing_not_open" };
    }
    throw error;
  }
}

export function startAdoptionReview(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<CoordinatorMoveResult> {
  return coordinatorMove(ctx, input, "start_review");
}

export function putAdopterInContact(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<CoordinatorMoveResult> {
  return coordinatorMove(ctx, input, "put_in_contact", async (tx, found) =>
    (await adopterConsentGiven(
      tx,
      found.application.applicantUserId,
      "adoption_contact_sharing"
    ))
      ? null
      : { ok: false, error: "sharing_consent_missing" }
  );
}

export type AdoptionOutcome = "adopted" | "not_matched" | "declined";

const OUTCOME_ACTION = {
  adopted: "record_adopted",
  not_matched: "record_not_matched",
  declined: "decline",
} as const satisfies Record<AdoptionOutcome, AdoptionApplicationAction>;

const outcomeInput = z.object({
  outcome: z.enum(["adopted", "not_matched", "declined"]),
});

export function recordAdoptionOutcome(
  ctx: UseCaseContext,
  input: {
    applicationId: string;
    outcome: AdoptionOutcome;
    reason?: string | null;
  }
): Promise<CoordinatorMoveResult> {
  const parsed = outcomeInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(invalidInput(parsed.error));
  return catchListingNotOpen(
    coordinatorMove(ctx, input, OUTCOME_ACTION[parsed.data.outcome])
  );
}
