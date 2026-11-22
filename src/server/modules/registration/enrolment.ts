// What enrolling one student (#75) and importing many (#76) share, so an
// imported row is enrolled exactly as a student added by hand: which
// children an institution registration already has, and writing one
// enrolment whole (the profile, the registration and its audit entry).

import { and, eq, inArray, ne, or, sql } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { participantProfile, registration } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import { matchKeys, studentRefKey } from "./domain/identity-key";
import type { PreparedStudent } from "./domain/prepare-student";
import { initialRegistrationStatus } from "./domain/registration-status";
import { studentColumns } from "./student-profile";

/** The unique index that keeps one live registration per child and competition. */
export const ONE_LIVE_REGISTRATION =
  "registration_participant_competition_unique";

/**
 * The match keys (./domain/identity-key.ts) of the children enrolled, and
 * not withdrawn, under the institution registration who share a key with
 * any of `students`: the same name and date of birth, or the same roll
 * number.
 */
export async function findEnrolledKeys(
  db: AppDb,
  institutionRegistrationId: string,
  students: readonly { identityHash: string; studentRefKey: string | null }[]
): Promise<Set<string>> {
  const hashes = [...new Set(students.map((each) => each.identityHash))];
  const refs = [
    ...new Set(
      students.flatMap((each) =>
        each.studentRefKey === null ? [] : [each.studentRefKey]
      )
    ),
  ];
  if (hashes.length === 0) return new Set();
  const found = await db
    .select({
      identityHash: participantProfile.identityHash,
      studentRef: participantProfile.studentRef,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(registration.institutionRegistrationId, institutionRegistrationId),
        ne(registration.status, "withdrawn"),
        or(
          inArray(participantProfile.identityHash, hashes),
          refs.length === 0
            ? undefined
            : inArray(sql`upper(${participantProfile.studentRef})`, refs)
        )
      )
    );
  return new Set(
    found.flatMap((each) =>
      matchKeys({
        identityHash: each.identityHash,
        studentRefKey: studentRefKey(each.studentRef),
      })
    )
  );
}

export type EnrolmentTarget = {
  institutionId: string;
  institutionRegistrationId: string;
  competitionId: string;
  /** The role that allowed it (from `authorize`), for the audit entry. */
  actorRole: Role | null;
};

/**
 * Enrols `student` under the target registration, in `tx`: the child's
 * profile at the institution, a registration in their age group and the
 * `registration.student_enrolled` audit entry. The caller has checked the
 * child isn't enrolled already.
 */
export async function insertEnrolment(
  tx: AppDb,
  ctx: UseCaseContext,
  target: EnrolmentTarget,
  student: PreparedStudent
): Promise<{ registrationId: string }> {
  const now = ctx.clock.now();
  const createdBy = ctx.actor.kind === "user" ? ctx.actor.userId : null;
  const { institutionId, institutionRegistrationId, competitionId } = target;

  // One profile per child at the institution: enrolling them in another
  // competition finds it and keeps the latest details given.
  const columns = studentColumns(ctx, student.details);
  const [profile] = await tx
    .insert(participantProfile)
    .values({
      id: uuidv7(now),
      ownerKind: "institution",
      managingInstitutionId: institutionId,
      ...columns,
      identityHash: student.identityHash,
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        participantProfile.managingInstitutionId,
        participantProfile.identityHash,
      ],
      targetWhere: sql`${participantProfile.managingInstitutionId} IS NOT NULL`,
      set: { ...columns, updatedAt: now },
    })
    .returning({ id: participantProfile.id });
  if (!profile) throw new Error("The participant profile was not saved");

  const registrationId = uuidv7(now);
  const { status } = initialRegistrationStatus("institution");
  const ageGroupId = student.ageGroup.id;
  await tx.insert(registration).values({
    id: registrationId,
    participantProfileId: profile.id,
    competitionId,
    route: "institution",
    institutionRegistrationId,
    ageGroupId,
    status,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit(tx, ctx, {
    action: "registration.student_enrolled",
    entity: { type: "registration", id: registrationId },
    before: null,
    after: {
      participantProfileId: profile.id,
      institutionRegistrationId,
      competitionId,
      ageGroupId,
      status,
    },
    actorRole: target.actorRole,
  });
  return { registrationId };
}
