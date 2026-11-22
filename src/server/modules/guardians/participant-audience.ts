// The notifications module's `guardian_of_participant` audience (#81): who
// hears about the child a registration is for. Messages about a minor go
// to their verified guardians; a teen with an own login gets an inbox copy
// only; a minor with no verified guardian is told nothing, recorded
// against their login if they have one. The rule is the pure
// ./domain/minor-audience.ts; this loads its facts.
//
// A guardian-kept profile is a child's. A profile of one's own is an
// adult's, who hears through `registration_owner` instead: a teen on a
// profile of their own has their registrations held for a guardian, which
// can't be confirmed, so nothing about them is routed here.
//
// Loads under plain Node (the worker): relative imports only.

import { asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianLink,
  participantProfile,
  registration,
} from "../../db/schema";
import { minorAudience } from "./domain/minor-audience";

type Member =
  | string
  | { userId: string; channels: "in_app_only" }
  | { userId: string; suppressed: "no_guardian" };

export async function guardianOfParticipant(
  db: AppDb,
  registrationId: string
): Promise<Member[]> {
  const [subject] = await db
    .select({
      profileId: participantProfile.id,
      ownerKind: participantProfile.ownerKind,
      loginUserId: participantProfile.loginUserId,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(eq(registration.id, registrationId));
  if (subject?.ownerKind !== "guardian") return [];
  const links = await db
    .select({
      userId: guardian.userId,
      verifiedAt: guardian.verifiedAt,
      revokedAt: guardianLink.revokedAt,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(eq(guardianLink.participantProfileId, subject.profileId))
    .orderBy(asc(guardianLink.createdAt), asc(guardianLink.id));
  const audience = minorAudience({
    minor: true,
    loginUserId: subject.loginUserId,
    guardians: links.map((link) => ({
      userId: link.userId,
      verified: link.verifiedAt !== null,
      revoked: link.revokedAt !== null,
    })),
  });
  if (audience.kind === "suppress") {
    return subject.loginUserId
      ? [{ userId: subject.loginUserId, suppressed: "no_guardian" }]
      : [];
  }
  return audience.recipients.map((recipient) =>
    recipient.channels === "all"
      ? recipient.userId
      : { userId: recipient.userId, channels: "in_app_only" }
  );
}
