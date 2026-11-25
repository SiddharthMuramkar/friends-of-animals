// Who hears about an adoption application (#130), for the notifications
// module's audiences, and what its messages may say.
//
// The applicant (always an adult) hears at every step on every channel the
// route names. The listing organisation's representatives hear at every
// step too, but no message names the applicant or carries their contact:
// a representative signs in to read it, and sees it only once the
// coordinator has put them in touch. Coordinators (global, or scoped to
// the organisation) hear that an application is waiting or was withdrawn.
// A coordinator's reason for an ending is never in a message.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, isNull, or } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import {
  adoptionApplication,
  adoptionListing,
  directoryListing,
  userRole,
} from "../../../db/schema";

/** The variables every adoption application message may use. */
export const ADOPTION_APPLICATION_VARIABLES = [
  "animal.name",
  "organisation.name",
] as const;

async function facts(db: AppDb, applicationId: string) {
  const [row] = await db
    .select({
      applicantUserId: adoptionApplication.applicantUserId,
      animalName: adoptionListing.name,
      directoryListingId: adoptionListing.directoryListingId,
      organisationName: directoryListing.name,
    })
    .from(adoptionApplication)
    .innerJoin(
      adoptionListing,
      eq(adoptionListing.id, adoptionApplication.adoptionListingId)
    )
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .where(eq(adoptionApplication.id, applicationId));
  return row ?? null;
}

/** Whoever applied. */
export async function adoptionApplicant(
  db: AppDb,
  applicationId: string
): Promise<string[]> {
  const found = await facts(db, applicationId);
  return found ? [found.applicantUserId] : [];
}

async function holders(
  db: AppDb,
  role: "organisation_representative" | "adoption_coordinator",
  directoryListingId: string,
  { global }: { global: boolean }
): Promise<string[]> {
  const scoped = and(
    eq(userRole.scopeType, "organisation"),
    eq(userRole.scopeId, directoryListingId)
  );
  const rows = await db
    .selectDistinct({ userId: userRole.userId })
    .from(userRole)
    .where(
      and(
        eq(userRole.role, role),
        global
          ? or(
              scoped,
              and(eq(userRole.scopeType, "global"), isNull(userRole.scopeId))
            )
          : scoped
      )
    )
    .orderBy(asc(userRole.userId));
  return rows.map((row) => row.userId);
}

/** The listing organisation's representatives. */
export async function adoptionListingRepresentatives(
  db: AppDb,
  applicationId: string
): Promise<string[]> {
  const found = await facts(db, applicationId);
  if (!found) return [];
  return holders(db, "organisation_representative", found.directoryListingId, {
    global: false,
  });
}

/** The coordinators who may see the application. */
export async function adoptionCoordinators(
  db: AppDb,
  applicationId: string
): Promise<string[]> {
  const found = await facts(db, applicationId);
  if (!found) return [];
  return holders(db, "adoption_coordinator", found.directoryListingId, {
    global: true,
  });
}

/**
 * The animal's and organisation's names, read when the message goes.
 * Empty once the application is gone, which fails the delivery rather
 * than send a message with a hole in it.
 */
export async function adoptionApplicationValues(
  db: AppDb,
  applicationId: string
): Promise<Record<string, string>> {
  const found = await facts(db, applicationId);
  if (!found) return {};
  return {
    "animal.name": found.animalName,
    "organisation.name": found.organisationName,
  };
}
