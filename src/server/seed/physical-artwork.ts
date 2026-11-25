// #93: realistic examples on a separate, already-judging competition.
// Other preview competitions and their entry workflows remain unchanged.
import { and, eq } from "drizzle-orm";
import {
  competitionAgeGroup,
  entry,
  entryFile,
  entryVerification,
  fileAsset,
  institutionRegistration,
  participantProfile,
  physicalArtwork,
  registration,
} from "../db/schema";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { SEED_ARTWORK_COMPETITION } from "./competitions";
import { SEED_PARTICIPANTS } from "./participants";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_PAYMENTS } from "./payments";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_SCOPES } from "./scopes";
import { seedFilesLocation } from "./files";
import { seedEntryDerivatives } from "./entries";
import type { Seeder } from "./types";

const ID = (n: number) =>
  `01938a00-0000-7000-8000-000000093${String(n).padStart(3, "0")}`;
const code = (n: number) => `ORIG27-A-5EED0${n}`;
export const SEED_ARTWORK = {
  competitionId: SEED_ARTWORK_COMPETITION.id,
  schoolRegistrationId: ID(0),
  codes: [code(1), code(2), code(3), code(4)],
} as const;

export const seedPhysicalArtwork: Seeder = async ({ db, clock, storage }) => {
  const now = clock.now();
  const days = (n: number) => new Date(now.getTime() + n * 86400000);
  const competitionId = SEED_ARTWORK_COMPETITION.id;
  const ageGroups = await db
    .select()
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, competitionId));
  if (ageGroups.length === 0) return;
  await db
    .insert(institutionRegistration)
    .values({
      id: SEED_ARTWORK.schoolRegistrationId,
      institutionId: SEED_SCOPES.institution.id,
      competitionId,
      reference: "ORIG27-I-5EED1",
      status: "active",
      participationDeclaredAt: days(-60),
      createdAt: days(-180),
      updatedAt: days(-60),
    })
    .onConflictDoNothing();
  const examples = [
    {
      profileId: SEED_PAYMENTS.paid.students[0]!.profileOf,
      school: true,
      status: "requested",
      deadline: -1,
      title: "A garden for butterflies",
      age: 12,
    },
    {
      profileId: SEED_PAYMENTS.paid.students[1]!.profileOf,
      school: true,
      status: "dispatched",
      deadline: 5,
      title: "Shelter in the rain",
      age: 12,
    },
    {
      profileId: SEED_GUARDIANS.children.young.profileId,
      school: false,
      status: "requested",
      deadline: 5,
      title: "The friendly street dogs",
      age: 8,
    },
    {
      profileId: SEED_PARTICIPANTS.confirmed.profileId,
      school: false,
      status: "received",
      deadline: 5,
      title: "Water for the birds",
      age: 36,
    },
  ] as const;
  for (const [index, example] of examples.entries()) {
    const n = index + 1;
    const [profile] = await db
      .select()
      .from(participantProfile)
      .where(eq(participantProfile.id, example.profileId));
    const group = ageGroups.find(
      (g) => g.minAge <= example.age && g.maxAge >= example.age
    );
    if (!profile || !group) continue;
    const registrationId = ID(10 + n),
      entryId = ID(20 + n),
      artworkId = ID(30 + n),
      fileId = ID(40 + n);
    const { bucket, keyPrefix: prefix } = seedFilesLocation();
    const uploader = example.school
      ? SEED_INSTITUTIONS.verified.admin.id
      : (profile.ownerUserId ?? SEED_GUARDIANS.guardian.id);
    const dispatched = example.status !== "requested";
    const received = example.status === "received";
    await db.transaction(async (tx) => {
      await tx
        .insert(registration)
        .values({
          id: registrationId,
          participantProfileId: profile.id,
          competitionId,
          route: example.school ? "institution" : "individual",
          institutionRegistrationId: example.school
            ? SEED_ARTWORK.schoolRegistrationId
            : null,
          ageGroupId: group.id,
          status: "confirmed",
          registrationNumber: `ORIG27-R-5EED0${n}`,
          createdAt: days(-160),
          updatedAt: days(-60),
        })
        .onConflictDoNothing();
      const [reg] = await tx
        .select()
        .from(registration)
        .where(
          and(
            eq(registration.id, registrationId),
            eq(registration.status, "confirmed")
          )
        );
      if (!reg) return;
      await tx
        .insert(entry)
        .values({
          id: entryId,
          code: `ORIG27-E-5EED0${n}`,
          competitionId,
          registrationId,
          participantProfileId: profile.id,
          discipline: "drawing",
          title: example.title,
          description:
            "A drawing showing kindness to animals in our neighbourhood.",
          status: "foa_verified",
          submittedAt: days(-60),
          createdAt: days(-60),
          updatedAt: days(-20),
        })
        .onConflictDoNothing();
      await tx
        .insert(fileAsset)
        .values({
          id: fileId,
          ownerUserId: uploader,
          purpose: "entry_image",
          contentType: "image/jpeg",
          sizeBytes: 162800,
          bucket,
          storageKey: storageKeyFor({ prefix, purpose: "entry_image", fileId }),
          status: "clean",
          uploadedAt: days(-60),
          createdAt: days(-60),
          updatedAt: days(-60),
        })
        .onConflictDoNothing();
      await tx
        .insert(entryFile)
        .values({
          id: ID(50 + n),
          entryId,
          fileAssetId: fileId,
          attemptNumber: 1,
          kind: "image",
          status: "live",
          uploadCompletedAt: days(-60),
          becameLiveAt: days(-60),
          createdAt: days(-60),
          updatedAt: days(-60),
        })
        .onConflictDoNothing();
      await tx
        .insert(entryVerification)
        .values({
          id: ID(60 + n),
          entryId,
          decision: "verified",
          decidedAt: days(-20),
        })
        .onConflictDoNothing();
      await tx
        .insert(physicalArtwork)
        .values({
          id: artworkId,
          artworkCode: code(n),
          entryId,
          competitionId,
          status: example.status,
          registrationId,
          institutionRegistrationId: reg.institutionRegistrationId,
          requestedAt: days(-15),
          dispatchDeadline: days(example.deadline),
          packagingInstructions:
            "Protect the original drawing in a rigid folder and label it with the Artwork ID.",
          facilityAddress:
            "FOA Demonstration Facility, Sample Road, Mumbai (preview only)",
          shippingPayer: "sender",
          courierName: dispatched ? "Blue Dart" : null,
          trackingNumber: dispatched ? `SAMPLE0930${n}` : null,
          dispatchedAt: dispatched ? days(-3) : null,
          receivedAt: received ? days(-1) : null,
        })
        .onConflictDoNothing();
    });
    if (storage)
      await seedEntryDerivatives(db, storage, { bucket, prefix, fileId, now });
  }
};
