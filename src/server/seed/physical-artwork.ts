// #93: realistic examples on a separate, already-judging competition.
// Other preview competitions and their entry workflows remain unchanged.
import { and, eq } from "drizzle-orm";
import {
  artworkCustodyEvent,
  artworkDiscrepancy,
  artworkPhoto,
  artworkVerification,
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
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { SEED_ARTWORK_COMPETITION } from "./competitions";
import { SEED_PARTICIPANTS } from "./participants";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_PAYMENTS } from "./payments";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_SCOPES } from "./scopes";
import { seedFilesLocation } from "./files";
import { seedEntryDerivatives } from "./entries";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { ensureGrant } from "./access";
import { ensureSeedAuthenticator } from "./second-factor";
import type { Seeder } from "./types";

const ID = (n: number) =>
  `01938a00-0000-7000-8000-000000093${String(n).padStart(3, "0")}`;
const code = (n: number) => `ORIG27-A-5EED0${n}`;
export const SEED_ARTWORK = {
  competitionId: SEED_ARTWORK_COMPETITION.id,
  schoolRegistrationId: ID(0),
  codes: [code(1), code(2), code(3), code(4), code(5), code(6), code(7)],
} as const;

export const SEED_ARTWORK_VERIFIER = {
  id: ID(199),
  email: "artwork-verifier@example.test",
  name: "Sample Artwork Verifier",
} as const;
export const seedPhysicalArtwork: Seeder = async (deps) => {
  const { db, clock, storage } = deps;
  const verifier = await ensureVerifiedAccount(deps, SEED_ARTWORK_VERIFIER);
  await ensureGrant(deps, verifier.id, {
    role: "foa_verifier",
    scope: { type: "global" },
  });
  await ensureSeedAuthenticator(deps, verifier.id);
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
    {
      profileId: SEED_PARTICIPANTS.pending.profileId,
      school: false,
      status: "discrepancy",
      deadline: 5,
      title: "A little garden for stray cats",
      age: 40,
    },
    {
      profileId: SEED_GUARDIANS.children.teen.profileId,
      school: false,
      status: "verified",
      deadline: 5,
      title: "Kindness in our colony",
      age: 15,
    },
    {
      profileId: SEED_PAYMENTS.paid.students[2]!.profileOf,
      school: true,
      status: "verified",
      deadline: 5,
      title: "City birds and trees",
      age: 12,
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
    const received =
      example.status === "received" ||
      example.status === "verified" ||
      example.status === "discrepancy";
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
      const [added] = await tx
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
          storageLocation:
            example.status === "verified" ? "MUM / Store 1 / Rack B" : null,
        })
        .onConflictDoNothing()
        .returning({ id: physicalArtwork.id });
      if (!added) return;
      if (received)
        await tx.insert(artworkCustodyEvent).values({
          id: ID(70 + n),
          artworkId,
          kind: "received",
          actorUserId: verifier.id,
          at: days(-1),
        });
      if (example.status === "discrepancy") {
        await tx.insert(artworkDiscrepancy).values({
          id: ID(80 + n),
          artworkId,
          reason: "mismatch",
          notes:
            "The label differs from the submitted entry. Verify the correct Artwork ID.",
          raisedAt: now,
          raisedBy: verifier.id,
        });
      }
      if (example.status === "verified") {
        await tx.insert(artworkVerification).values({
          artworkId,
          verifiedBy: verifier.id,
          verifiedAt: now,
          codeMatchesLabel: true,
          creatorConfirmed: true,
          matchesDigital: true,
          consentDocumentsOk: true,
          condition: "good",
          widthMm: 297,
          heightMm: 420,
          material: "Watercolour on paper",
        });
        await tx.insert(artworkCustodyEvent).values({
          id: ID(90 + n),
          artworkId,
          kind: "stored",
          actorUserId: verifier.id,
          at: now,
          location: "MUM / Store 1 / Rack B",
        });
        for (const [j, kind] of (["front", "back"] as const).entries()) {
          const photoFileId = ID(100 + n * 2 + j);
          const storageKey = storageKeyFor({
            prefix,
            purpose: "artwork_condition_photo",
            fileId: photoFileId,
          });
          const bytes = await sharp(
            await readFile(
              new URL(
                "../../assets/site-art/scenes/scene-street-neighbours.webp",
                import.meta.url
              )
            )
          )
            .resize({ width: 800 })
            .jpeg()
            .toBuffer();
          if (storage)
            await storage.write({
              bucket,
              key: storageKey,
              contentType: "image/jpeg",
              body: bytes,
            });
          await tx.insert(fileAsset).values({
            id: photoFileId,
            ownerUserId: verifier.id,
            purpose: "artwork_condition_photo",
            contentType: "image/jpeg",
            sizeBytes: bytes.length,
            bucket,
            storageKey,
            status: "clean",
            uploadedAt: now,
            scannedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          await tx.insert(artworkPhoto).values({
            id: ID(120 + n * 2 + j),
            artworkId,
            fileAssetId: photoFileId,
            kind,
            createdBy: verifier.id,
            createdAt: now,
            selectedAt: now,
          });
        }
      }
    });
    if (storage)
      await seedEntryDerivatives(db, storage, { bucket, prefix, fileId, now });
  }
};
