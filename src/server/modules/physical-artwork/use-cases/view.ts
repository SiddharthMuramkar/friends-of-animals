// How an artwork reads to staff and to its sender: the row plus what the
// clock says about it (overdue, dispatched late). Shared by the read use
// cases and the write use cases' results.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";

import {
  physicalArtwork,
  type PhysicalArtworkRow,
} from "../../../db/schema";
import type { PhysicalArtworkStatus } from "../domain/status";
import type { SenderScope, ShippingPayer } from "../platform";

export type ArtworkView = {
  artworkId: string;
  /** The Artwork ID, such as `PAWS26-A-8H3TZ0`. */
  artworkCode: string;
  status: PhysicalArtworkStatus;
  entryId: string;
  competitionId: string;
  /** Who sends it: a school registration's coordinators, or the individual. */
  route: "institution" | "individual";
  institutionRegistrationId: string | null;
  registrationId: string;
  requestedAt: Date;
  dispatchDeadline: Date;
  /** Still waiting for dispatch, and the deadline has passed. */
  overdue: boolean;
  /** When the dispatch reminder went out, if it has. */
  dispatchReminderSentAt: Date | null;
  packagingInstructions: string;
  shippingPayer: ShippingPayer;
  facilityAddress: string;
  courierName: string | null;
  trackingNumber: string | null;
  dispatchedAt: Date | null;
  /** Dispatched after the deadline. */
  dispatchedLate: boolean;
  receivedAt: Date | null;
  /** Received, though the sender never recorded the dispatch. */
  receivedWithoutDispatch: boolean;
};

export function artworkView(row: PhysicalArtworkRow, now: Date): ArtworkView {
  const deadline = row.dispatchDeadline.getTime();
  return {
    artworkId: row.id,
    artworkCode: row.artworkCode,
    status: row.status,
    entryId: row.entryId,
    competitionId: row.competitionId,
    route: row.institutionRegistrationId === null ? "individual" : "institution",
    institutionRegistrationId: row.institutionRegistrationId,
    registrationId: row.registrationId,
    requestedAt: row.requestedAt,
    dispatchDeadline: row.dispatchDeadline,
    overdue: row.status === "requested" && now.getTime() > deadline,
    dispatchReminderSentAt: row.dispatchReminderSentAt,
    packagingInstructions: row.packagingInstructions,
    shippingPayer: row.shippingPayer === "foa" ? "foa" : "sender",
    facilityAddress: row.facilityAddress,
    courierName: row.courierName,
    trackingNumber: row.trackingNumber,
    dispatchedAt: row.dispatchedAt,
    dispatchedLate:
      row.dispatchedAt !== null && row.dispatchedAt.getTime() > deadline,
    receivedAt: row.receivedAt,
    receivedWithoutDispatch: row.receivedAt !== null && row.dispatchedAt === null,
  };
}

/**
 * The artworks a sender scope covers: a school registration's (sent by its
 * coordinators), or an individual registration's that came through no
 * school. Null when the scope covers nothing.
 */
export function sentBy(scope: SenderScope): SQL | null {
  const conditions: SQL[] = [];
  if (scope.institutionRegistrationIds.length > 0) {
    conditions.push(
      inArray(
        physicalArtwork.institutionRegistrationId,
        scope.institutionRegistrationIds
      )
    );
  }
  if (scope.registrationIds.length > 0) {
    const individual = and(
      isNull(physicalArtwork.institutionRegistrationId),
      inArray(physicalArtwork.registrationId, scope.registrationIds)
    );
    if (individual) conditions.push(individual);
  }
  if (conditions.length === 0) return null;
  return or(...conditions) ?? null;
}

/** The one sender an artwork belongs to, as a comparable key. */
export function senderKey(row: {
  institutionRegistrationId: string | null;
  registrationId: string;
}): string {
  return row.institutionRegistrationId === null
    ? `registration:${row.registrationId}`
    : `institution_registration:${row.institutionRegistrationId}`;
}

/** Matches an artwork by its id. */
export const byId = (id: string) => eq(physicalArtwork.id, id);
