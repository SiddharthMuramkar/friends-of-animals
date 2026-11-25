// Who a rights request involves (#115): the requester's age, the children a
// guardian may file for and see, and the grievance officers. Use cases read
// these facts and the pure rules in ./domain decide.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import {
  guardian,
  guardianLink,
  participantProfile,
  user,
  userRole,
} from "../../../db/schema";
import { verifiedLink } from "../../guardians/child-access";
import { ageAt } from "../../participants/domain/age";
import { parseIsoDate } from "../../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../../registration/student-profile";
import type { PrivacySubjectKind } from "./domain/filing";

/** Someone staff see by name: an assignee, a note's author. */
export type PersonRef = { id: string; name: string };

function ageOf(cipher: FieldCipher, dobCiphertext: string, now: Date): number {
  const dateOfBirth = parseIsoDate(
    cipher.decrypt(PROFILE_PURPOSE.dob, dobCiphertext)
  );
  if (!dateOfBirth) throw new Error("A stored date of birth is not a date");
  return ageAt(dateOfBirth, now);
}

/**
 * The requester's age from their own participant profile (#78) or the
 * child profile their teen login belongs to (#81); null when they have
 * neither, as an adult who never registered.
 */
export async function requesterAge(
  db: AppDb,
  cipher: FieldCipher,
  userId: string,
  now: Date
): Promise<number | null> {
  const [own] = await db
    .select({ dob: participantProfile.dobCiphertext })
    .from(participantProfile)
    .where(
      or(
        eq(participantProfile.loginUserId, userId),
        and(
          eq(participantProfile.ownerUserId, userId),
          eq(participantProfile.ownerKind, "self")
        )
      )
    )
    .orderBy(asc(participantProfile.id))
    .limit(1);
  return own ? ageOf(cipher, own.dob, now) : null;
}

export type ChildFacts = {
  guardian: "verified" | "unverified" | "not_linked";
  ageYears: number;
};

/**
 * How `userId` stands to the child profile `childId`: linked by a live
 * guardian link, and verified or not. A child that doesn't exist reads as
 * not linked, so nothing is said about it.
 */
export async function childFacts(
  db: AppDb,
  cipher: FieldCipher,
  userId: string,
  childId: string,
  now: Date
): Promise<ChildFacts> {
  const [link] = await db
    .select({
      verifiedAt: guardian.verifiedAt,
      dob: participantProfile.dobCiphertext,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianLink.participantProfileId)
    )
    .where(
      and(
        eq(guardian.userId, userId),
        eq(guardianLink.participantProfileId, childId),
        isNull(guardianLink.revokedAt)
      )
    );
  if (!link) return { guardian: "not_linked", ageYears: 0 };
  return {
    guardian: link.verifiedAt === null ? "unverified" : "verified",
    ageYears: ageOf(cipher, link.dob, now),
  };
}

/** A child a verified guardian looks after, as rights requests name them. */
export type GuardedChild = {
  profileId: string;
  /** A teen's own login (#81), whose own requests the guardian sees. */
  loginUserId: string | null;
  name: string;
};

/** Every child `userId` looks after through a live, verified link. */
export async function guardedChildren(
  db: AppDb,
  userId: string
): Promise<GuardedChild[]> {
  return db
    .selectDistinct({
      profileId: participantProfile.id,
      loginUserId: participantProfile.loginUserId,
      name: participantProfile.fullName,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianLink.participantProfileId)
    )
    .where(and(eq(guardian.userId, userId), verifiedLink()))
    .orderBy(asc(participantProfile.fullName), asc(participantProfile.id));
}

/** The child a request is about, among `children`, if it is one of them. */
export function guardedChildOf(
  children: readonly GuardedChild[],
  subject: { subjectKind: PrivacySubjectKind; subjectId: string }
): GuardedChild | undefined {
  return children.find((child) =>
    subject.subjectKind === "participant_profile"
      ? child.profileId === subject.subjectId
      : child.loginUserId === subject.subjectId
  );
}

/** Every user holding the global grievance officer role, by name. */
export async function grievanceOfficers(db: AppDb): Promise<PersonRef[]> {
  return db
    .selectDistinct({ id: user.id, name: user.name })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(
      and(
        eq(userRole.role, "grievance_officer"),
        eq(userRole.scopeType, "global")
      )
    )
    .orderBy(asc(user.name), asc(user.id));
}

/** Whether `userId` holds the global grievance officer role. */
export async function isGrievanceOfficer(
  db: AppDb,
  userId: string
): Promise<boolean> {
  const officers = await db
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, userId),
        eq(userRole.role, "grievance_officer"),
        eq(userRole.scopeType, "global")
      )
    );
  return officers.length > 0;
}

/** Names of the accounts among `ids`, for the officer's pages. */
export async function namesOf(
  db: AppDb,
  ids: readonly (string | null)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, wanted));
  return new Map(rows.map((row) => [row.id, row.name]));
}
