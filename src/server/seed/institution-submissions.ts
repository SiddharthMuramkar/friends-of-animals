// School-route submissions seed data (#87): the seeded verified
// institution registered for "Trees for Birds" (TREES27, free, open for
// submissions), so a preview's coordinator roster has every kind of row:
// one entry submitted (with its derivatives, as the entries seed makes
// them), one still being checked, one rejected by the scan, two confirmed
// students with no entry yet, and one student whose registration isn't
// confirmed. Its conduct is not certified, so the conduct page offers it.
//
// The students are fictional, with example.test guardian emails and
// +91 90000 087xx numbers, and go through the same rules as a
// coordinator's (prepareStudent). The entries are the institution's
// authorised person's uploads. Seed data: no transition history, audit
// entry or notice. Idempotent: rows already there are left alone, and an
// upload made on the preview has its own IDs, which a reseed never touches.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import {
  competition,
  competitionFee,
  entry,
  entryFile,
  fileAsset,
  institution,
  institutionRegistration,
  participantProfile,
  registration,
} from "../db/schema";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { indianDateAt } from "../modules/registration/domain/calendar-date";
import { prepareStudent } from "../modules/registration/domain/prepare-student";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import {
  normaliseStudentPhone,
  studentColumns,
} from "../modules/registration/student-profile";
import { SEED_SCHOOL_SUBMISSIONS_COMPETITION } from "./competitions";
import { seedEntryDerivatives } from "./entries";
import { seedFilesLocation } from "./files";
import { SEED_INSTITUTIONS } from "./institutions";
import type { Seeder } from "./types";

const ID = (n: string) => `01938a00-0000-7000-8000-0000000087${n}`;

type Outcome = "submitted" | "processing" | "rejected";

const ENTRY_OUTCOMES = {
  submitted: { fileStatus: "live", assetStatus: "clean" },
  processing: { fileStatus: "pending", assetStatus: "uploaded" },
  rejected: { fileStatus: "rejected", assetStatus: "quarantined" },
} as const;

export const SEED_SCHOOL_SUBMISSIONS = {
  institutionRegistration: {
    id: ID("02"),
    institutionId: SEED_INSTITUTIONS.verified.id,
    competitionId: SEED_SCHOOL_SUBMISSIONS_COMPETITION.id,
    reference: "TREES27-I-5EED3",
  },
  /**
   * In roster order. `entry` names its outcome; the two without one are
   * where journeys upload (desktop, then mobile).
   */
  students: [
    ["Ananya Menon", "2016-02-09", "Class 5", "Rekha Menon", "1", "submitted"],
    ["Ishaan Rao", "2017-09-18", "Class 4", "Deepak Rao", "2", "processing"],
    ["Myra Pillai", "2015-12-01", "Class 6", "Suma Pillai", "3", "rejected"],
    ["Neel Desai", "2018-04-25", "Class 3", "Hetal Desai", "4", null],
    ["Tara Gokhale", "2016-10-30", "Class 5", "Madhav Gokhale", "5", null],
    ["Vihaan Shetty", "2017-06-12", "Class 4", "Priya Shetty", "6", "unpaid"],
  ].map(([fullName, dateOfBirth, grade, guardianName, n, outcome]) => ({
    fullName: fullName!,
    dateOfBirth: dateOfBirth!,
    grade: grade!,
    guardianName: guardianName!,
    guardianRelationship: "parent",
    guardianPhone: `+91 90000 0870${n}`,
    guardianEmail: `${guardianName!.split(" ")[0]!.toLowerCase()}.trees@example.test`,
    profileId: ID(`1${n}`),
    registrationId: ID(`2${n}`),
    confirmed: outcome !== "unpaid",
    registrationNumber: outcome === "unpaid" ? null : `TREES27-R-5EEDC${n}`,
    entry:
      outcome === "submitted" ||
      outcome === "processing" ||
      outcome === "rejected"
        ? {
            id: ID(`3${n}`),
            code: `TREES27-E-5EEDC${n}`,
            assetId: ID(`4${n}`),
            entryFileId: ID(`5${n}`),
            outcome: outcome as Outcome,
          }
        : null,
  })),
} as const;

const ENTRY_WORDS: Record<Outcome, { title: string; description: string }> = {
  submitted: {
    title: "Bulbuls in the gulmohar",
    description:
      "Two red-whiskered bulbuls feeding their chicks in the gulmohar by our school gate.",
  },
  processing: {
    title: "The banyan's crows",
    description: "Crows resting in the old banyan during the afternoon heat.",
  },
  rejected: {
    title: "A sunbird at the hibiscus",
    description: "A purple sunbird drinking from the hibiscus in our garden.",
  },
};

export const seedInstitutionSubmissions: Seeder = async (deps) => {
  const { db, clock, storage } = deps;
  const seed = SEED_SCHOOL_SUBMISSIONS.institutionRegistration;
  const uploader = SEED_INSTITUTIONS.verified.admin.id;
  const [school] = await db
    .select({
      pinCode: institution.pinCode,
      city: institution.city,
      state: institution.state,
    })
    .from(institution)
    .where(
      and(
        eq(institution.id, seed.institutionId),
        eq(institution.status, "verified")
      )
    );
  const [target] = await db
    .select({ ageCutoffDate: competition.ageCutoffDate })
    .from(competition)
    .where(eq(competition.id, seed.competitionId));
  if (!school || !target?.ageCutoffDate) return;
  const now = clock.now();
  const { bucket, keyPrefix: prefix } = seedFilesLocation();

  // Free for institutions, so confirmed students need no payment batch.
  await db
    .insert(competitionFee)
    .values({
      competitionId: seed.competitionId,
      route: "institution",
      amountMinor: 0n,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await db
    .insert(institutionRegistration)
    .values({
      id: seed.id,
      institutionId: seed.institutionId,
      competitionId: seed.competitionId,
      reference: seed.reference,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [registered] = await db
    .select({ id: institutionRegistration.id })
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, seed.id));
  if (!registered) return;

  const context = {
    ageCutoffDate: target.ageCutoffDate,
    ageGroups: await ageGroupsOf(db, seed.competitionId),
    today: indianDateAt(now),
    institutionDefaults: school,
  };
  for (const student of SEED_SCHOOL_SUBMISSIONS.students) {
    const prepared = prepareStudent(context, student, {
      normalisePhone: normaliseStudentPhone,
      blindIndex: deps.blindIndex,
    });
    if (!prepared.ok) {
      throw new Error(`Seed student ${student.fullName} is refused`);
    }
    // Kept as it is if the school's profile of this child exists already.
    await db
      .insert(participantProfile)
      .values({
        id: student.profileId,
        ownerKind: "institution",
        managingInstitutionId: seed.institutionId,
        ...studentColumns(deps, prepared.student.details),
        identityHash: prepared.student.identityHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [profile] = await db
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(eq(participantProfile.id, student.profileId));
    if (!profile) continue;
    await db
      .insert(registration)
      .values({
        id: student.registrationId,
        participantProfileId: profile.id,
        competitionId: seed.competitionId,
        route: "institution",
        institutionRegistrationId: seed.id,
        ageGroupId: prepared.student.ageGroup.id,
        status: student.confirmed ? "confirmed" : "enrolled",
        registrationNumber: student.registrationNumber,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const example = student.entry;
    if (!example) continue;
    const [confirmed] = await db
      .select({ id: registration.id })
      .from(registration)
      .where(
        and(
          eq(registration.id, student.registrationId),
          eq(registration.status, "confirmed")
        )
      );
    if (!confirmed) continue;
    const { fileStatus, assetStatus } = ENTRY_OUTCOMES[example.outcome];
    const submittedAt = example.outcome === "submitted" ? now : null;
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(entry)
        .values({
          id: example.id,
          code: example.code,
          competitionId: seed.competitionId,
          registrationId: student.registrationId,
          participantProfileId: profile.id,
          discipline: "painting",
          ...ENTRY_WORDS[example.outcome],
          status: example.outcome,
          submittedAt,
          createdByUserId: uploader,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: entry.id });
      if (!created) return;
      await tx.insert(fileAsset).values({
        id: example.assetId,
        ownerUserId: uploader,
        purpose: "entry_image",
        contentType: "image/jpeg",
        sizeBytes: 154_300,
        bucket,
        storageKey: storageKeyFor({
          prefix,
          purpose: "entry_image",
          fileId: example.assetId,
        }),
        status: assetStatus,
        uploadedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(entryFile).values({
        id: example.entryFileId,
        entryId: example.id,
        fileAssetId: example.assetId,
        attemptNumber: 1,
        kind: "image",
        status: fileStatus,
        uploadedByUserId: uploader,
        uploadCompletedAt: now,
        becameLiveAt: submittedAt,
        createdAt: now,
        updatedAt: now,
      });
    });
    if (!storage || fileStatus !== "live") continue;
    // Backfill a seed made without storage. An upload made on the preview
    // has its own IDs and is never touched by a reseed.
    const [live] = await db
      .select({ id: entryFile.id })
      .from(entryFile)
      .where(
        and(
          eq(entryFile.id, example.entryFileId),
          eq(entryFile.fileAssetId, example.assetId),
          eq(entryFile.status, "live")
        )
      );
    if (live) {
      await seedEntryDerivatives(db, storage, {
        bucket,
        prefix,
        fileId: example.assetId,
        now,
      });
    }
  }
};
