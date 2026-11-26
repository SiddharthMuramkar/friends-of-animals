import { and, eq, inArray, notLike, or } from "drizzle-orm";
import { participantProfile, registration } from "../../db/schema";
import type { Deps } from "../../deps";
import { activeGuardians, latestConsents } from "../campaigns/load-audience";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { isUnder18On } from "../announcements/domain/age";
import { ageAt, parseDateOfBirth } from "../participants/domain/age";
import type { InvitationRecipient } from "./actions";

export type AudienceDeps = Pick<Deps, "db" | "clock" | "cipher">;

export async function invitationAudience(
  { db, clock, cipher }: AudienceDeps,
  competitionId: string,
  profileIds?: readonly string[]
) {
  if (profileIds?.length === 0) return new Map<string, InvitationRecipient>();
  const rows = await db
    .select({ profile: participantProfile })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(registration.competitionId, competitionId),
        eq(registration.status, "confirmed"),
        notLike(participantProfile.identityHash, "erased:%"),
        profileIds ? inArray(participantProfile.id, [...profileIds]) : undefined
      )
    );
  const at = clock.now();
  const ageOf = (profile: typeof participantProfile.$inferSelect) => {
    const birth = parseDateOfBirth(
      cipher.decrypt(PROFILE_PURPOSE.dob, profile.dobCiphertext) ?? "",
      at
    );
    return birth ? ageAt(birth, at) : null;
  };
  const ownId = (profile: typeof participantProfile.$inferSelect) =>
    profile.ownerKind === "self" ? profile.ownerUserId : profile.loginUserId;
  const ownIds = rows.flatMap(({ profile }) =>
    ownId(profile) ? [ownId(profile)!] : []
  );
  const ids = rows.map(({ profile }) => profile.id);
  const [ownConsent, childConsent, guardians] = await Promise.all([
    latestConsents(db, "user", "messages", ownIds),
    latestConsents(db, "participant_profile", "communications", ids),
    activeGuardians(db, ids),
  ]);
  const candidates = rows.flatMap(({ profile }): InvitationRecipient[] => {
    const age = ageOf(profile);
    const own = ownId(profile);
    if (age !== null && age >= 18) {
      return own && ownConsent.get(own)?.status === "given"
        ? [
            {
              userId: own,
              relation: "self",
              profileId: profile.id,
              age,
              hasLogin: true,
            },
          ]
        : [];
    }
    const consent = childConsent.get(profile.id);
    return consent?.status === "given" &&
      consent.giverUserId &&
      guardians.get(profile.id)?.includes(consent.giverUserId)
      ? [
          {
            userId: consent.giverUserId,
            relation: "guardian",
            profileId: profile.id,
            age,
            hasLogin: Boolean(own),
          },
        ]
      : [];
  });
  if (!candidates.length) return new Map<string, InvitationRecipient>();
  // An account known to belong to a child may never be contacted directly,
  // even if it also appears elsewhere in the roster as a guardian.
  const candidateIds = [...new Set(candidates.map((r) => r.userId))];
  const profiles = await db
    .select()
    .from(participantProfile)
    .where(
      or(
        inArray(participantProfile.loginUserId, candidateIds),
        and(
          eq(participantProfile.ownerKind, "self"),
          inArray(participantProfile.ownerUserId, candidateIds)
        )
      )
    );
  const minors = new Set(
    profiles
      .filter((p) =>
        isUnder18On(cipher.decrypt(PROFILE_PURPOSE.dob, p.dobCiphertext), at)
      )
      .map(ownId)
  );
  return new Map(
    candidates.filter((r) => !minors.has(r.userId)).map((r) => [r.profileId, r])
  );
}
