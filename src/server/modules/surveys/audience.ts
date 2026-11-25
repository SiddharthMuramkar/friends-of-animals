import { and, eq, inArray, or } from "drizzle-orm";
import {
  guardian,
  guardianLink,
  institution,
  institutionRegistration,
  participantProfile,
  registration,
  userRole,
} from "../../db/schema";
import type { Deps } from "../../deps";
import { activeGuardians, latestConsents } from "../campaigns/load-audience";
import { isUnder18On } from "../announcements/domain/age";
import { PROFILE_PURPOSE } from "../registration/student-profile";

const profileFacts = {
  id: participantProfile.id,
  ownerKind: participantProfile.ownerKind,
  ownerUserId: participantProfile.ownerUserId,
  loginUserId: participantProfile.loginUserId,
  dobCiphertext: participantProfile.dobCiphertext,
};
// Only registered accounts with independently established consent enter this
// roster. A verified guardian is the respondent, never the child's login.
// Coalesce the same adult across all qualifying links, not by email/contact.
export async function surveyAudience(
  { db, cipher, clock }: Pick<Deps, "db" | "cipher" | "clock">,
  competitionId: string,
  recipientUserId?: string
) {
  const at = clock.now();
  // Dispatch and response need facts for only this account and its profiles,
  // not a scan of every other contestant on every individual delivery.
  const linkedProfiles = recipientUserId
    ? db
        .select({ id: guardianLink.participantProfileId })
        .from(guardianLink)
        .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
        .where(eq(guardian.userId, recipientUserId))
    : undefined;
  const rows = await db
    .select({ profile: profileFacts })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(registration.participantProfileId, participantProfile.id)
    )
    .where(
      and(
        eq(registration.competitionId, competitionId),
        eq(registration.status, "confirmed"),
        recipientUserId && linkedProfiles
          ? or(
              eq(participantProfile.loginUserId, recipientUserId),
              and(
                eq(participantProfile.ownerKind, "self"),
                eq(participantProfile.ownerUserId, recipientUserId)
              ),
              inArray(participantProfile.id, linkedProfiles)
            )
          : undefined
      )
    );
  const profileIds = rows.map(({ profile }) => profile.id);
  const [guardians, childConsent, coordinators] = await Promise.all([
    activeGuardians(db, profileIds),
    latestConsents(db, "participant_profile", "communications", profileIds),
    db
      .select({ userId: userRole.userId })
      .from(institutionRegistration)
      .innerJoin(
        institution,
        eq(institution.id, institutionRegistration.institutionId)
      )
      .innerJoin(
        userRole,
        and(
          eq(userRole.scopeId, institutionRegistration.institutionId),
          eq(userRole.scopeType, "institution"),
          eq(userRole.role, "institution_coordinator")
        )
      )
      .where(
        and(
          eq(institutionRegistration.competitionId, competitionId),
          eq(institutionRegistration.status, "active"),
          eq(institution.status, "verified"),
          recipientUserId ? eq(userRole.userId, recipientUserId) : undefined
        )
      ),
  ]);
  const adult = new Set(coordinators.map((x) => x.userId));
  const guardianConsent = new Set<string>();
  for (const { profile } of rows) {
    if (
      isUnder18On(
        cipher.decrypt(PROFILE_PURPOSE.dob, profile.dobCiphertext),
        at
      )
    ) {
      const consent = childConsent.get(profile.id);
      if (
        consent?.status === "given" &&
        consent.giverUserId &&
        guardians.get(profile.id)?.includes(consent.giverUserId)
      )
        guardianConsent.add(consent.giverUserId);
    } else {
      const account =
        profile.ownerKind === "self"
          ? profile.ownerUserId
          : profile.loginUserId;
      if (account) adult.add(account);
    }
  }
  const ids = [...new Set([...adult, ...guardianConsent])].filter(
    (id) => !recipientUserId || id === recipientUserId
  );
  if (!ids.length) return [];
  const [messages, profiles] = await Promise.all([
    latestConsents(db, "user", "messages", ids),
    db
      .select(profileFacts)
      .from(participantProfile)
      .where(
        or(
          inArray(participantProfile.loginUserId, ids),
          and(
            eq(participantProfile.ownerKind, "self"),
            inArray(participantProfile.ownerUserId, ids)
          )
        )
      ),
  ]);
  const minors = new Set(
    profiles.flatMap((p) =>
      isUnder18On(cipher.decrypt(PROFILE_PURPOSE.dob, p.dobCiphertext), at)
        ? [p.ownerKind === "self" ? p.ownerUserId : p.loginUserId]
        : []
    )
  );
  return ids
    .filter(
      (id) =>
        !minors.has(id) &&
        (guardianConsent.has(id) ||
          (adult.has(id) && messages.get(id)?.status === "given"))
    )
    .sort();
}
