// The account an adult's own registration belongs to (#78): who may pay
// for it, and who its messages go to. None for a school's student, whose
// profile no user owns, or for a registration that doesn't exist.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { participantProfile, registration } from "../../db/schema";

export async function registrationOwner(
  db: AppDb,
  registrationId: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ ownerUserId: participantProfile.ownerUserId })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(registration.id, registrationId),
        eq(registration.route, "individual"),
        eq(participantProfile.ownerKind, "self")
      )
    );
  return row?.ownerUserId ?? undefined;
}

/** The owner as an audience: nobody, or the one account. */
export async function ownerOfRegistration(
  db: AppDb,
  registrationId: string
): Promise<string[]> {
  const owner = await registrationOwner(db, registrationId);
  return owner === undefined ? [] : [owner];
}
