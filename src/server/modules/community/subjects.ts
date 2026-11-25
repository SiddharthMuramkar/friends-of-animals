import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { AppDb } from "../../db/app-db";
import { communityMember, participantProfile } from "../../db/schema";
import { lockProfileSubject, lockUserSubject } from "../consent/repository";
import type { Subject } from "./domain/subject";

export function subjectColumns(subject: Subject) {
  return {
    subjectUserId: subject.kind === "user" ? subject.userId : null,
    subjectProfileId: subject.kind === "profile" ? subject.profileId : null,
  };
}

export function subjectOf(row: {
  subjectUserId: string | null;
  subjectProfileId: string | null;
}): Subject {
  return row.subjectUserId !== null
    ? { kind: "user", userId: row.subjectUserId }
    : { kind: "profile", profileId: row.subjectProfileId! };
}

/** All of one's own keys, never a guardian's linked children. */
export async function personKeys(
  db: AppDb,
  userId: string
): Promise<Subject[]> {
  const profiles = await db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(
      or(
        and(
          eq(participantProfile.ownerKind, "self"),
          eq(participantProfile.ownerUserId, userId)
        ),
        eq(participantProfile.loginUserId, userId)
      )
    );
  return [
    { kind: "user", userId },
    ...profiles.map(({ id }): Subject => ({ kind: "profile", profileId: id })),
  ];
}

/** A child's profile and their own login if one exists, not their guardian. */
export async function childKeys(
  db: AppDb,
  profileId: string
): Promise<Subject[]> {
  const [profile] = await db
    .select({
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      loginUserId: participantProfile.loginUserId,
    })
    .from(participantProfile)
    .where(eq(participantProfile.id, profileId));
  const login =
    profile?.loginUserId ??
    (profile?.ownerKind === "self" ? profile.ownerUserId : null);
  return [
    { kind: "profile", profileId },
    ...(login ? await personKeys(db, login) : []).filter(
      (key) => key.kind === "user" || key.profileId !== profileId
    ),
  ];
}

export function subjectKeys(db: AppDb, subject: Subject) {
  return subject.kind === "user"
    ? personKeys(db, subject.userId)
    : childKeys(db, subject.profileId);
}

export function belongsTo(
  keys: readonly Subject[],
  columns: { subjectUserId: PgColumn; subjectProfileId: PgColumn }
): SQL {
  const users = keys.flatMap((key) =>
    key.kind === "user" ? [key.userId] : []
  );
  const profiles = keys.flatMap((key) =>
    key.kind === "profile" ? [key.profileId] : []
  );
  return or(
    users.length ? inArray(columns.subjectUserId, users) : sql`false`,
    profiles.length ? inArray(columns.subjectProfileId, profiles) : sql`false`
  )!;
}

/** Serialize lifetime writes on the person's login when there is one;
 * otherwise their profile. Reads include keys predating a teen login. */
export async function lockPerson(
  db: AppDb,
  subject: Subject
): Promise<Subject> {
  const keys = await subjectKeys(db, subject);
  const login = keys.find((key) => key.kind === "user");
  if (login?.kind === "user") {
    await lockUserSubject(db, login.userId);
    return login;
  }
  if (subject.kind === "profile") {
    await lockProfileSubject(db, subject.profileId);
    return subject;
  }
  throw new Error("A membership subject must exist");
}

export async function communityMemberFor(db: AppDb, subject: Subject) {
  const [row] = await db
    .select()
    .from(communityMember)
    .where(belongsTo(await subjectKeys(db, subject), communityMember))
    .orderBy(asc(communityMember.joinedAt), asc(communityMember.id))
    .limit(1);
  return row ?? null;
}
