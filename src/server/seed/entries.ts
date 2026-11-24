// Entries seed data (#85): the preview shows three outcomes on Asha's own
// entries, one per registration (an individual registration has one
// entry): submitted on NEIGH27, still being checked on ROOF27, and
// rejected by the scan on BIRDS27. Asha's ROOF27 and BIRDS27 registrations
// are made here, confirmed, in the two competitions open for submissions
// (SEED_ENTRY_COMPETITIONS).
//
// The submitted example's private derivatives are made from an FOA sample
// illustration and written to `storage` (the local disk store or the
// preview's bucket) when the seed has one; the original is never written.
// Seed data: no transition history, audit entry or notice. Idempotent:
// rows already there are left alone, and a replacement Asha uploads on
// the preview has its own IDs, which a reseed never touches.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";

import type { AppDb } from "../db/app-db";
import {
  competitionAgeGroup,
  entry,
  entryFile,
  fileAsset,
  fileDerivative,
  registration,
} from "../db/schema";
import { uuidv7 } from "../ids";
import {
  derivativeKeyFor,
  derivativeKindsFor,
} from "../modules/files/domain/media-work";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { sharpMediaProcessor } from "../ports/media-sharp";
import type { ObjectStorage } from "../ports/storage";
import { SEED_ENTRY_COMPETITIONS } from "./competitions";
import { seedFilesLocation } from "./files";
import { SEED_PARTICIPANTS } from "./participants";
import type { Seeder } from "./types";

const ASHA = SEED_PARTICIPANTS.confirmed;

const EXAMPLES = [
  {
    code: "NEIGH27-E-5EEDA1",
    registrationId: ASHA.registrationId,
    title: "Shade for the street dogs",
    description: "I drew two dogs resting under the neem tree near our gate.",
    status: "submitted",
    fileStatus: "live",
    assetStatus: "clean",
  },
  {
    code: "ROOF27-E-5EEDA2",
    registrationId: "01938a00-0000-7000-8000-000000008511",
    title: "The pigeons next door",
    description:
      "A pair of pigeons sharing a bowl of water on a hot afternoon.",
    status: "processing",
    fileStatus: "pending",
    assetStatus: "uploaded",
  },
  {
    code: "BIRDS27-E-5EEDA3",
    registrationId: "01938a00-0000-7000-8000-000000008512",
    title: "A sparrow in the jasmine",
    description: "A sparrow uses the hedge outside our kitchen for shelter.",
    status: "rejected",
    fileStatus: "rejected",
    assetStatus: "quarantined",
  },
] as const;

async function seedEntryDerivatives(
  db: AppDb,
  storage: Pick<ObjectStorage, "write">,
  {
    bucket,
    prefix,
    fileId,
    now,
  }: { bucket: string; prefix: string; fileId: string; now: Date }
) {
  const kinds = derivativeKindsFor({
    purpose: "entry_image",
    contentType: "image/webp",
  });
  const made = await db
    .select({ kind: fileDerivative.kind })
    .from(fileDerivative)
    .where(eq(fileDerivative.fileAssetId, fileId));
  // Made by an earlier seed: decoding and resizing again would only slow
  // every reseed (and every test that seeds a preview).
  if (kinds.every((kind) => made.some((row) => row.kind === kind))) return;
  const source = new URL(
    "../../assets/site-art/scenes/scene-street-neighbours.webp",
    import.meta.url
  );
  const { derivatives } = await sharpMediaProcessor().processImage({
    bytes: await readFile(source),
    kinds,
  });
  for (const { kind, width, height, bytes } of derivatives) {
    const key = derivativeKeyFor({ prefix, fileId, kind });
    await storage.write({
      bucket,
      key,
      body: bytes,
      contentType: "image/webp",
    });
    await db
      .insert(fileDerivative)
      .values({
        id: uuidv7(now),
        fileAssetId: fileId,
        kind,
        bucket,
        storageKey: key,
        contentType: "image/webp",
        width,
        height,
        sizeBytes: bytes.length,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
}

export const seedEntries: Seeder = async ({ db, clock, storage }) => {
  const now = clock.now();
  const { bucket, keyPrefix: prefix } = seedFilesLocation();
  await db.transaction(async (tx) => {
    const [confirmed] = await tx
      .select({ id: registration.id })
      .from(registration)
      .where(
        and(
          eq(registration.id, ASHA.registrationId),
          eq(registration.participantProfileId, ASHA.profileId),
          eq(registration.status, "confirmed")
        )
      );
    if (!confirmed) return;

    for (const [index, competition] of SEED_ENTRY_COMPETITIONS.entries()) {
      const [group] = await tx
        .select({ id: competitionAgeGroup.id })
        .from(competitionAgeGroup)
        .where(
          and(
            eq(competitionAgeGroup.competitionId, competition.id),
            eq(competitionAgeGroup.label, "Adults")
          )
        );
      if (!group) continue;
      await tx
        .insert(registration)
        .values({
          id: EXAMPLES[index + 1]!.registrationId,
          participantProfileId: ASHA.profileId,
          competitionId: competition.id,
          ageGroupId: group.id,
          route: "individual",
          status: "confirmed",
          registrationNumber: `${competition.code}-R-5EEDA1`,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }

    for (const [index, example] of EXAMPLES.entries()) {
      const [registered] = await tx
        .select({ competitionId: registration.competitionId })
        .from(registration)
        .where(
          and(
            eq(registration.id, example.registrationId),
            eq(registration.participantProfileId, ASHA.profileId),
            eq(registration.status, "confirmed")
          )
        );
      if (!registered) continue;
      const entryId = `01938a00-0000-7000-8000-00000000852${index + 1}`;
      const assetId = `01938a00-0000-7000-8000-00000000853${index + 1}`;
      const entryFileId = `01938a00-0000-7000-8000-00000000854${index + 1}`;
      const submittedAt = example.status === "submitted" ? now : null;
      const [created] = await tx
        .insert(entry)
        .values({
          id: entryId,
          code: example.code,
          competitionId: registered.competitionId,
          registrationId: example.registrationId,
          participantProfileId: ASHA.profileId,
          discipline: "drawing",
          title: example.title,
          description: example.description,
          status: example.status,
          submittedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: entry.id });
      if (created) {
        await tx.insert(fileAsset).values({
          id: assetId,
          ownerUserId: ASHA.userId,
          purpose: "entry_image",
          contentType: "image/jpeg",
          sizeBytes: 112_200,
          bucket,
          storageKey: storageKeyFor({
            prefix,
            purpose: "entry_image",
            fileId: assetId,
          }),
          status: example.assetStatus,
          uploadedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(entryFile).values({
          id: entryFileId,
          entryId,
          fileAssetId: assetId,
          attemptNumber: 1,
          kind: "image",
          status: example.fileStatus,
          uploadCompletedAt: now,
          becameLiveAt: submittedAt,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (!storage || example.fileStatus !== "live") continue;
      // Backfill a seed made without storage, or before the derivatives
      // existed. A participant's replacement has a different ID and is
      // never touched by a reseed.
      const [live] = await tx
        .select({ id: entryFile.id })
        .from(entryFile)
        .where(
          and(
            eq(entryFile.id, entryFileId),
            eq(entryFile.entryId, entryId),
            eq(entryFile.fileAssetId, assetId),
            eq(entryFile.status, "live")
          )
        );
      if (live)
        await seedEntryDerivatives(tx, storage, {
          bucket,
          prefix,
          fileId: assetId,
          now,
        });
    }
  });
};
