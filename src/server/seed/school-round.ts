// School round seed data (#89): Kinder Skies (SKIES26) is in school
// judging, so the seeded verified institution's registration for it
// (SKIES26-I-5EED2, from the payments seed) has an open round. Three of
// its confirmed students have submitted entries (two drawings, a
// painting), the coordinator has recorded a panel of two and picked a
// shortlist with school positions. Its conduct is not certified (the #87
// journey certifies it), so the round can't be finalised yet.
//
// The round opens the way the worker opens it (openSchoolRounds), so every
// confirmed registration of a competition in school judging gets one. The
// entries are the institution's authorised person's uploads. Seed data: no
// transition history, audit entry or notice for the entries and picks.
// Idempotent: rows already there are left alone.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import {
  competition,
  entry,
  entryFile,
  fileAsset,
  registration,
  schoolRound,
  schoolRoundPanelMember,
  schoolRoundPick,
  competitionCategory,
} from "../db/schema";
import type { Discipline } from "../modules/competitions/domain/vocabulary";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { openSchoolRounds } from "../modules/school-round/open-school-rounds";
import { seedEntryDerivatives } from "./entries";
import { seedFilesLocation } from "./files";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_PAYMENTS } from "./payments";
import type { Seeder } from "./types";

const ID = (n: string) => `01938a00-0000-7000-8000-0000000089${n}`;

const SEED_ACTOR = { kind: "system", process: "seed" } as const;

export const SEED_SCHOOL_ROUND = {
  institutionRegistrationId: SEED_PAYMENTS.paid.institutionRegistrationId,
  reference: SEED_PAYMENTS.paid.reference,
  competitionId: SEED_PAYMENTS.paid.competitionId,
  panel: [
    { fullName: "Lata Kulkarni", designation: "Art teacher" },
    { fullName: "Farhan Qureshi", designation: "Vice principal" },
  ],
  /** The paid students' entries, with their pick (null: not picked). */
  entries: [
    {
      registrationId: SEED_PAYMENTS.paid.students[0]!.registrationId,
      id: ID("01"),
      code: "SKIES26-E-5EEDS1",
      assetId: ID("11"),
      entryFileId: ID("21"),
      discipline: "drawing",
      title: "Kites and kites",
      description:
        "A black kite circling over the rooftop kites on Makar Sankranti.",
      pick: { position: 1 },
    },
    {
      registrationId: SEED_PAYMENTS.paid.students[1]!.registrationId,
      id: ID("02"),
      code: "SKIES26-E-5EEDS2",
      assetId: ID("12"),
      entryFileId: ID("22"),
      discipline: "drawing",
      title: "The pigeon's ledge",
      description: "Pigeons resting on our window ledge, safe from the string.",
      pick: { position: null },
    },
    {
      registrationId: SEED_PAYMENTS.paid.students[2]!.registrationId,
      id: ID("03"),
      code: "SKIES26-E-5EEDS3",
      assetId: ID("13"),
      entryFileId: ID("23"),
      discipline: "painting",
      title: "A safe sky",
      description: "Children flying paper kites without glass-coated string.",
      pick: null,
    },
  ] satisfies readonly {
    registrationId: string;
    id: string;
    code: string;
    assetId: string;
    entryFileId: string;
    discipline: Discipline;
    title: string;
    description: string;
    pick: { position: number | null } | null;
  }[],
} as const;

export const seedSchoolRound: Seeder = async (deps) => {
  const { db, clock, storage } = deps;
  const seed = SEED_SCHOOL_ROUND;
  const uploader = SEED_INSTITUTIONS.verified.admin.id;
  const [target] = await db
    .select({ status: competition.status })
    .from(competition)
    .where(eq(competition.id, seed.competitionId));
  if (target?.status !== "school_judging") return;
  const now = clock.now();
  const { bucket, keyPrefix: prefix } = seedFilesLocation();

  for (const example of seed.entries) {
    const [student] = await db
      .select({
        profileId: registration.participantProfileId,
        status: registration.status,
      })
      .from(registration)
      .where(eq(registration.id, example.registrationId));
    if (student?.status !== "confirmed") continue;
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(entry)
        .values({
          id: example.id,
          code: example.code,
          competitionId: seed.competitionId,
          registrationId: example.registrationId,
          participantProfileId: student.profileId,
          discipline: example.discipline,
          title: example.title,
          description: example.description,
          status: "submitted",
          submittedAt: now,
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
        sizeBytes: 162_800,
        bucket,
        storageKey: storageKeyFor({
          prefix,
          purpose: "entry_image",
          fileId: example.assetId,
        }),
        status: "clean",
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
        status: "live",
        uploadedByUserId: uploader,
        uploadCompletedAt: now,
        becameLiveAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    if (storage) {
      await seedEntryDerivatives(db, storage, {
        bucket,
        prefix,
        fileId: example.assetId,
        now,
      });
    }
  }

  await openSchoolRounds({ db, clock }, seed, SEED_ACTOR);
  const [round] = await db
    .select({ id: schoolRound.id, status: schoolRound.status })
    .from(schoolRound)
    .where(
      eq(schoolRound.institutionRegistrationId, seed.institutionRegistrationId)
    );
  if (round?.status !== "open") return;

  const [panelled] = await db
    .select({ id: schoolRoundPanelMember.id })
    .from(schoolRoundPanelMember)
    .where(eq(schoolRoundPanelMember.roundId, round.id))
    .limit(1);
  if (!panelled) {
    await db.insert(schoolRoundPanelMember).values(
      seed.panel.map((member, sortOrder) => ({
        id: ID(`3${sortOrder}`),
        roundId: round.id,
        sortOrder,
        ...member,
      }))
    );
  }

  for (const example of seed.entries) {
    if (!example.pick) continue;
    const [category] = await db
      .select({ id: competitionCategory.id })
      .from(entry)
      .innerJoin(registration, eq(registration.id, entry.registrationId))
      .innerJoin(
        competitionCategory,
        and(
          eq(competitionCategory.competitionId, entry.competitionId),
          eq(competitionCategory.discipline, entry.discipline),
          eq(competitionCategory.ageGroupId, registration.ageGroupId)
        )
      )
      .where(and(eq(entry.id, example.id), eq(entry.status, "submitted")));
    if (!category) continue;
    await db
      .insert(schoolRoundPick)
      .values({
        entryId: example.id,
        roundId: round.id,
        categoryId: category.id,
        position: example.pick.position,
        pickedByUserId: uploader,
        pickedAt: now,
      })
      .onConflictDoNothing();
  }
};
