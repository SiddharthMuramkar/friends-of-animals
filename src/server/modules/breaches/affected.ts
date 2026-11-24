// Who each person a breach touched is, as the notice planner
// (./domain/notice-recipients.ts) needs them: their own account, whether
// they are a child now, and their active guardians (#116).
//
// - An account is a child's when it is a teen's own login (81a) or holds a
//   profile of its own whose date of birth says under 18 (81b); any other
//   account is an adult's.
// - A profile is a child's by its date of birth. A child's guardians are
//   the verified guardians linked to it whose link isn't revoked. An adult's
//   profile reaches its owner (their own profile) or its login (a guardian's
//   child who has turned 18); a school's adult student has no account.
//
// Ages come from the decrypted date of birth on India's calendar at `now`.
// Pages collect account and guardian facts in bulk.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";

import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianLink,
  participantProfile,
  user,
} from "../../db/schema";
import { verifiedLink } from "../guardians/child-access";
import { isAdultAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import type { AffectedPerson, AffectedRef } from "./domain/notice-recipients";

type ProfileFacts = {
  id: string;
  ownerKind: "institution" | "self" | "guardian";
  ownerUserId: string | null;
  loginUserId: string | null;
  dobCiphertext: string;
};

const PROFILE_FACTS = {
  id: participantProfile.id,
  ownerKind: participantProfile.ownerKind,
  ownerUserId: participantProfile.ownerUserId,
  loginUserId: participantProfile.loginUserId,
  dobCiphertext: participantProfile.dobCiphertext,
};

const accountOfProfile = (profile: ProfileFacts) =>
  profile.ownerKind === "self" ? profile.ownerUserId : profile.loginUserId;

function isMinorProfile(cipher: FieldCipher, now: Date, profile: ProfileFacts) {
  const dateOfBirth = parseIsoDate(
    cipher.decrypt(PROFILE_PURPOSE.dob, profile.dobCiphertext)
  );
  if (!dateOfBirth) {
    throw new Error(`Profile ${profile.id}'s date of birth isn't a date`);
  }
  return !isAdultAt(dateOfBirth, now);
}

/** The facts the planner needs about each of `refs`, in their order. */
export async function affectedPeople(
  db: AppDb,
  cipher: FieldCipher,
  now: Date,
  refs: readonly AffectedRef[],
  { lock = false } = {}
): Promise<AffectedPerson[]> {
  const userIds = [
    ...new Set(refs.filter((r) => r.type === "user").map((r) => r.id)),
  ];
  const profileIds = [
    ...new Set(
      refs.filter((r) => r.type === "participant_profile").map((r) => r.id)
    ),
  ];

  const accounts = new Set(
    userIds.length === 0
      ? []
      : (
          await db
            .select({ id: user.id })
            .from(user)
            .where(inArray(user.id, userIds))
        ).map((row) => row.id)
  );
  // The profiles that say whether an account is a child's.
  const accountQuery = db
    .select(PROFILE_FACTS)
    .from(participantProfile)
    .where(
      or(
        inArray(participantProfile.loginUserId, userIds),
        and(
          inArray(participantProfile.ownerUserId, userIds),
          eq(participantProfile.ownerKind, "self")
        )
      )
    );
  const profileQuery = db
    .select(PROFILE_FACTS)
    .from(participantProfile)
    .where(inArray(participantProfile.id, profileIds));
  const accountProfiles = userIds.length
    ? await (lock ? accountQuery.for("share") : accountQuery)
    : [];
  const namedProfiles = profileIds.length
    ? await (lock ? profileQuery.for("share") : profileQuery)
    : [];

  const minorProfileIds = new Set(
    [...accountProfiles, ...namedProfiles]
      .filter((profile) => isMinorProfile(cipher, now, profile))
      .map((profile) => profile.id)
  );
  const guardiansByProfile = await activeGuardians(
    db,
    [...minorProfileIds],
    lock
  );
  const guardiansOf = (profiles: readonly ProfileFacts[]) =>
    profiles.flatMap((p) => guardiansByProfile.get(p.id) ?? []);
  const byId = new Map(namedProfiles.map((profile) => [profile.id, profile]));

  return refs.map((ref): AffectedPerson => {
    if (ref.type === "user") {
      if (!accounts.has(ref.id)) {
        return { ref, userId: null, minor: false, guardians: [] };
      }
      const childProfiles = accountProfiles.filter(
        (profile) =>
          minorProfileIds.has(profile.id) &&
          accountOfProfile(profile) === ref.id
      );
      return childProfiles.length > 0
        ? {
            ref,
            userId: ref.id,
            minor: true,
            guardians: guardiansOf(childProfiles),
          }
        : { ref, userId: ref.id, minor: false, guardians: [] };
    }
    const profile = byId.get(ref.id);
    if (!profile) {
      return { ref, userId: null, minor: false, guardians: [] };
    }
    const ownAccount = accountOfProfile(profile);
    return minorProfileIds.has(profile.id)
      ? {
          ref,
          userId: ownAccount,
          minor: true,
          guardians: guardiansOf([profile]),
        }
      : { ref, userId: ownAccount, minor: false, guardians: [] };
  });
}

/** Minor accounts represented by the given guardians, on any account page. */
export async function minorAccountsOfGuardians(
  db: AppDb,
  cipher: FieldCipher,
  now: Date,
  guardianUserIds: string[]
): Promise<AffectedPerson[]> {
  const links = await db
    .select({ ...PROFILE_FACTS, guardianUserId: guardian.userId })
    .from(guardian)
    .innerJoin(guardianLink, eq(guardian.id, guardianLink.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianLink.participantProfileId)
    )
    .where(
      and(
        inArray(guardian.userId, guardianUserIds),
        verifiedLink(),
        or(
          isNotNull(participantProfile.loginUserId),
          and(
            eq(participantProfile.ownerKind, "self"),
            isNotNull(participantProfile.ownerUserId)
          )
        )
      )
    );

  const children: AffectedPerson[] = [];
  for (const link of links) {
    const userId = accountOfProfile(link);
    if (userId === null || !isMinorProfile(cipher, now, link)) continue;
    children.push({
      ref: { type: "user", id: userId },
      userId,
      minor: true,
      guardians: [{ userId: link.guardianUserId, profileId: link.id }],
    });
  }
  return children;
}

/** Each profile's verified guardians with an unrevoked link, in link order. */
async function activeGuardians(
  db: AppDb,
  profileIds: readonly string[],
  lock: boolean
) {
  const byProfile = new Map<string, { userId: string; profileId: string }[]>();
  if (profileIds.length === 0) return byProfile;
  const query = db
    .select({
      profileId: guardianLink.participantProfileId,
      userId: guardian.userId,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        inArray(guardianLink.participantProfileId, [...profileIds]),
        verifiedLink()
      )
    )
    .orderBy(asc(guardianLink.createdAt), asc(guardianLink.id));
  const links = await (lock ? query.for("share") : query);
  for (const link of links) {
    byProfile.set(link.profileId, [
      ...(byProfile.get(link.profileId) ?? []),
      link,
    ]);
  }
  return byProfile;
}
