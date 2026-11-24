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
// can't be confirmed, so nothing about them is routed here, but for a
// cancellation (#80), which can mark such a held registration
// (`awaitingGuardian`): the teen's guardians hear of it, the teen in the
// inbox.
//
// Loads under plain Node (the worker): relative imports only.

import { asc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianLink,
  participantProfile,
  registration,
} from "../../db/schema";
import type { AudienceMember } from "../notifications/domain/audience-member";
import { minorAudience, type AudienceSubject } from "./domain/minor-audience";

/** Link facts for guardian routing, in the order they were created. */
export async function guardianLinksByProfile(
  db: AppDb,
  profileIds: readonly string[]
): Promise<Map<string, AudienceSubject["guardians"]>> {
  const links = new Map<string, AudienceSubject["guardians"][number][]>();
  if (profileIds.length === 0) return links;
  const rows = await db
    .select({
      profileId: guardianLink.participantProfileId,
      userId: guardian.userId,
      verifiedAt: guardian.verifiedAt,
      revokedAt: guardianLink.revokedAt,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(inArray(guardianLink.participantProfileId, [...new Set(profileIds)]))
    .orderBy(asc(guardianLink.createdAt), asc(guardianLink.id));
  for (const row of rows) {
    const facts = links.get(row.profileId) ?? [];
    facts.push({
      userId: row.userId,
      verified: row.verifiedAt !== null,
      revoked: row.revokedAt !== null,
    });
    links.set(row.profileId, facts);
  }
  return links;
}

export async function guardianOfParticipant(
  db: AppDb,
  registrationId: string,
  awaitingGuardian = false
): Promise<AudienceMember[]> {
  const [subject] = await db
    .select({
      profileId: participantProfile.id,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      loginUserId: participantProfile.loginUserId,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(eq(registration.id, registrationId));
  if (
    !subject ||
    (subject.ownerKind !== "guardian" &&
      !(awaitingGuardian && subject.ownerKind === "self"))
  ) {
    return [];
  }
  const loginUserId =
    subject.ownerKind === "self" ? subject.ownerUserId : subject.loginUserId;
  const links = await guardianLinksByProfile(db, [subject.profileId]);
  const audience = minorAudience({
    minor: true,
    loginUserId,
    guardians: links.get(subject.profileId) ?? [],
  });
  if (audience.kind === "suppress") {
    return loginUserId
      ? [{ userId: loginUserId, suppressed: "no_guardian" }]
      : [];
  }
  return audience.recipients.map((recipient) =>
    recipient.channels === "all"
      ? recipient.userId
      : { userId: recipient.userId, channels: "in_app_only" }
  );
}
