// Who an individual registration belongs to. An adult's own (#78) is
// theirs: they pay for it and its messages go to them. A guardian's child's
// (#81) is paid for by a guardian linked to the child, verified, while the
// link is active; its messages go to the guardians
// (../notifications/audiences.ts). None for a school's student, whose
// profile no user owns, or for a registration that doesn't exist.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianLink,
  participantProfile,
  registration,
} from "../../db/schema";
import { verifiedLink } from "../guardians/child-access";

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

/**
 * Whether `userId` pays for the registration: it is their own, or a
 * guardian's child's and they are that child's verified guardian.
 */
export async function paysFor(
  db: AppDb,
  registrationId: string,
  userId: string
): Promise<boolean> {
  if ((await registrationOwner(db, registrationId)) === userId) return true;
  const [link] = await db
    .select({ id: guardianLink.id })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .innerJoin(
      guardianLink,
      eq(guardianLink.participantProfileId, participantProfile.id)
    )
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(registration.id, registrationId),
        eq(registration.route, "individual"),
        eq(participantProfile.ownerKind, "guardian"),
        eq(guardian.userId, userId),
        verifiedLink()
      )
    )
    .limit(1);
  return link !== undefined;
}

/** The owner as an audience: nobody, or the one account. */
export async function ownerOfRegistration(
  db: AppDb,
  registrationId: string
): Promise<string[]> {
  const owner = await registrationOwner(db, registrationId);
  return owner === undefined ? [] : [owner];
}
