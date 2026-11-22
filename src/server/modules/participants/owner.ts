// The account an adult's own registration belongs to (#78), for the
// messages that go to them: none for a school's student, whose profile no
// user owns.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { participantProfile, registration } from "../../db/schema";

export async function ownerOfRegistration(
  db: AppDb,
  registrationId: string
): Promise<string[]> {
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
        eq(participantProfile.ownerKind, "self")
      )
    );
  return row?.ownerUserId ? [row.ownerUserId] : [];
}
