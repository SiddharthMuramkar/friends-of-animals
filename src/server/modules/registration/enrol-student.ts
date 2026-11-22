// enrolStudent({ institutionId, reference, student }) (#75): a coordinator,
// or the authorised person, of an institution registered for a
// competition adds one student while registration is open. The student
// becomes a participant profile the institution manages, with a
// registration in the age group their date of birth puts them in on the
// competition's cut-off date.
//
// The rules are pure (./domain/prepare-student.ts): checking the details,
// the age group, the identity hash. This shell loads the facts, refuses a
// child already enrolled, and saves the profile, the registration and the
// audit entry in one transaction.

import { and, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { participantProfile, registration } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import { indianDateAt } from "./domain/calendar-date";
import type { EnrolmentState } from "./domain/enrolment-state";
import {
  prepareStudent,
  type PreparedStudent,
  type StudentProblem,
} from "./domain/prepare-student";
import { initialRegistrationStatus } from "./domain/registration-status";
import type { StudentField, StudentInput } from "./domain/student-details";
import { ageGroupsOf, loadEnrolmentFacts } from "./enrolment-facts";
import { normaliseStudentPhone, studentColumns } from "./student-profile";

export type EnrolStudentInput = {
  institutionId: string;
  /** The institution registration's reference, e.g. PAWS27-I-Q2W9R. */
  reference: string;
  student: StudentInput;
};

export type EnrolmentRefusal =
  | "not_found"
  | Exclude<EnrolmentState, "open">
  | "already_enrolled";

export type EnrolStudentResult =
  | {
      ok: true;
      registrationId: string;
      ageGroup: { id: string; label: string };
      /** Details given that this student's case doesn't keep. */
      ignored: StudentField[];
    }
  | InvalidInput
  | { ok: false; error: "invalid_student"; problems: StudentProblem[] }
  | { ok: false; error: EnrolmentRefusal };

/** Generous for any field; the details' own rules are tighter. */
const text = z.string().max(1000).optional();

const enrolInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
  student: z.object({
    fullName: text,
    dateOfBirth: text,
    grade: text,
    studentRef: text,
    address: text,
    pinCode: text,
    city: text,
    state: text,
    phone: text,
    email: text,
    guardianName: text,
    guardianRelationship: text,
    guardianPhone: text,
    guardianEmail: text,
  }),
});

/**
 * Whether the child is already enrolled under this institution
 * registration: the same name and date of birth, or the same roll number.
 */
async function alreadyEnrolled(
  tx: AppDb,
  institutionRegistrationId: string,
  student: PreparedStudent
): Promise<boolean> {
  const sameChild = or(
    eq(participantProfile.identityHash, student.identityHash),
    student.studentRefKey === null
      ? undefined
      : sql`upper(${participantProfile.studentRef}) = ${student.studentRefKey}`
  );
  const [found] = await tx
    .select({ id: registration.id })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(registration.institutionRegistrationId, institutionRegistrationId),
        ne(registration.status, "withdrawn"),
        sameChild
      )
    )
    .limit(1);
  return found !== undefined;
}

export async function enrolStudent(
  ctx: UseCaseContext,
  input: EnrolStudentInput
): Promise<EnrolStudentResult> {
  const parsed = enrolInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, reference, student } = parsed.data;
  const resource = institutionResource(institutionId);
  await authorize(ctx, "institution.coordinate", resource);
  const now = ctx.clock.now();
  const createdBy = ctx.actor.kind === "user" ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    const facts = await loadEnrolmentFacts(
      tx,
      { institutionId, reference },
      now,
      { lock: true }
    );
    // Again inside the transaction: a role revoked since the first check
    // counts.
    const { role: actorRole } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "institution.coordinate",
      resource
    );
    if (!facts) return { ok: false, error: "not_found" } as const;
    if (facts.enrolment !== "open") {
      return { ok: false, error: facts.enrolment } as const;
    }
    const { competitionId, id: institutionRegistrationId } =
      facts.institutionRegistration;

    const prepared = prepareStudent(
      {
        ageCutoffDate: facts.competition.ageCutoffDate,
        ageGroups: await ageGroupsOf(tx, competitionId),
        today: indianDateAt(now),
        institutionDefaults: facts.institution,
      },
      student,
      { normalisePhone: normaliseStudentPhone, blindIndex: ctx.blindIndex }
    );
    if (!prepared.ok) {
      return {
        ok: false,
        error: "invalid_student",
        problems: prepared.problems,
      } as const;
    }
    const enrolling = prepared.student;
    if (await alreadyEnrolled(tx, institutionRegistrationId, enrolling)) {
      return { ok: false, error: "already_enrolled" } as const;
    }

    // One profile per child at the institution: enrolling them in another
    // competition finds it and keeps the latest details given.
    const columns = studentColumns(ctx, enrolling.details);
    const [profile] = await tx
      .insert(participantProfile)
      .values({
        id: uuidv7(now),
        ownerKind: "institution",
        managingInstitutionId: institutionId,
        ...columns,
        identityHash: enrolling.identityHash,
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
    const ageGroupId = enrolling.ageGroup.id;
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
      actorRole,
    });
    return {
      ok: true,
      registrationId,
      ageGroup: { id: ageGroupId, label: enrolling.ageGroup.label },
      ignored: prepared.student.ignored,
    } as const;
  });
}
