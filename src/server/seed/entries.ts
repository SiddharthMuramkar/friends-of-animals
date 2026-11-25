// Entries seed data (#85): the preview shows three outcomes on Asha's own
// entries, one per registration (an individual registration has one
// entry): submitted on NEIGH27, still being checked on ROOF27, and
// rejected by the scan on BIRDS27. Asha's ROOF27 and BIRDS27 registrations
// are made here, confirmed, in the two competitions open for submissions
// (SEED_ENTRY_COMPETITIONS). Ravi gets confirmed registrations there too,
// with a submitted video on ROOF27 and a submitted typed essay on BIRDS27
// (#86); the video's copy and poster are committed samples
// (src/assets/seed/), never an original.
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
  participantProfile,
  registration,
} from "../db/schema";
import { uuidv7 } from "../ids";
import { essayBodyFromText, essayBodyText } from "../rich-text/essay";
import { countWords } from "../modules/entries/domain/essay-text";
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
const RAVI = SEED_PARTICIPANTS.pending;

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

type SampleDerivatives = Awaited<
  ReturnType<ReturnType<typeof sharpMediaProcessor>["processImage"]>
>["derivatives"];

/**
 * The sample illustration's derivatives, made once per process: every
 * seeded live entry (#85, #87) shows the same picture, and decoding and
 * resizing it again would only slow each seed.
 */
let sample: Promise<SampleDerivatives> | undefined;

function sampleDerivatives(
  kinds: Parameters<
    ReturnType<typeof sharpMediaProcessor>["processImage"]
  >[0]["kinds"]
): Promise<SampleDerivatives> {
  sample ??= (async () => {
    const source = new URL(
      "../../assets/site-art/scenes/scene-street-neighbours.webp",
      import.meta.url
    );
    const { derivatives } = await sharpMediaProcessor().processImage({
      bytes: await readFile(source),
      kinds,
    });
    return derivatives;
  })();
  return sample;
}

/** Writes a live entry file's derivatives from an FOA sample illustration. */
export async function seedEntryDerivatives(
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
  for (const { kind, width, height, bytes } of await sampleDerivatives(kinds)) {
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

/** Ravi's video (ROOF27) and typed essay (BIRDS27) entries (#86). */
const RAVI_EXAMPLES = [
  {
    competitionIndex: 0,
    registrationId: "01938a00-0000-7000-8000-000000008611",
    entryId: "01938a00-0000-7000-8000-000000008621",
    entryFileId: "01938a00-0000-7000-8000-000000008641",
    assetId: "01938a00-0000-7000-8000-000000008631",
    code: "ROOF27-E-5EEDB1",
    discipline: "videography",
    title: "Pigeons at the water tank",
    description: "A short clip of pigeons taking turns at our rooftop bowl.",
  },
  {
    competitionIndex: 1,
    registrationId: "01938a00-0000-7000-8000-000000008612",
    entryId: "01938a00-0000-7000-8000-000000008622",
    entryFileId: "01938a00-0000-7000-8000-000000008642",
    assetId: null,
    code: "BIRDS27-E-5EEDB2",
    discipline: "essay",
    title: "Why the sparrows came back",
    description: "An essay about the hedge our building planted for sparrows.",
  },
] as const;

const RAVI_ESSAY = [
  "Three summers ago our building cut the old hedge by the gate. The sparrows that lived in it left, and the mornings went quiet.",
  "Last year the residents' committee planted a new hedge of jasmine and curry leaf. We put a shallow bowl of water under it and kept it full.",
  "By the monsoon the sparrows were back. Now they bathe in the bowl every afternoon, and the children on the third floor count them.",
].join("\n\n");

const SEED_VIDEO = {
  copy: new URL("../../assets/seed/entry-video.mp4", import.meta.url),
  poster: new URL("../../assets/seed/entry-video-poster.jpg", import.meta.url),
  width: 640,
  height: 360,
  durationMs: 4_000,
} as const;

async function seedVideoDerivatives(
  db: AppDb,
  storage: Pick<ObjectStorage, "write">,
  {
    bucket,
    prefix,
    fileId,
    now,
  }: { bucket: string; prefix: string; fileId: string; now: Date }
) {
  for (const [kind, contentType, source, durationMs] of [
    ["video_mp4", "video/mp4", SEED_VIDEO.copy, SEED_VIDEO.durationMs],
    ["video_poster", "image/jpeg", SEED_VIDEO.poster, null],
  ] as const) {
    const key = derivativeKeyFor({ prefix, fileId, kind });
    const bytes = new Uint8Array(await readFile(source));
    await storage.write({ bucket, key, body: bytes, contentType });
    await db
      .insert(fileDerivative)
      .values({
        id: uuidv7(now),
        fileAssetId: fileId,
        kind,
        bucket,
        storageKey: key,
        contentType,
        width: SEED_VIDEO.width,
        height: SEED_VIDEO.height,
        durationMs,
        sizeBytes: bytes.length,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
}

/** Ravi's confirmed registrations and his video and essay entries (#86). */
async function seedRaviEntries(
  tx: AppDb,
  storage: Pick<ObjectStorage, "write"> | undefined,
  { now, bucket, prefix }: { now: Date; bucket: string; prefix: string }
) {
  const [profile] = await tx
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.id, RAVI.profileId));
  if (!profile) return;
  for (const example of RAVI_EXAMPLES) {
    const competition = SEED_ENTRY_COMPETITIONS[example.competitionIndex]!;
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
        id: example.registrationId,
        participantProfileId: RAVI.profileId,
        competitionId: competition.id,
        ageGroupId: group.id,
        route: "individual",
        status: "confirmed",
        registrationNumber: `${competition.code}-R-5EEDB1`,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [registered] = await tx
      .select({ id: registration.id })
      .from(registration)
      .where(
        and(
          eq(registration.id, example.registrationId),
          eq(registration.participantProfileId, RAVI.profileId),
          eq(registration.status, "confirmed")
        )
      );
    if (!registered) continue;
    const [created] = await tx
      .insert(entry)
      .values({
        id: example.entryId,
        code: example.code,
        competitionId: competition.id,
        registrationId: example.registrationId,
        participantProfileId: RAVI.profileId,
        discipline: example.discipline,
        title: example.title,
        description: example.description,
        status: "submitted",
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: entry.id });
    if (created && example.assetId) {
      await tx.insert(fileAsset).values({
        id: example.assetId,
        ownerUserId: RAVI.userId,
        purpose: "entry_video",
        contentType: "video/mp4",
        sizeBytes: 2_400_000,
        bucket,
        storageKey: storageKeyFor({
          prefix,
          purpose: "entry_video",
          fileId: example.assetId,
        }),
        status: "clean",
        uploadedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (created) {
      const body = essayBodyFromText(RAVI_ESSAY);
      await tx.insert(entryFile).values({
        id: example.entryFileId,
        entryId: example.entryId,
        attemptNumber: 1,
        status: "live",
        uploadCompletedAt: now,
        becameLiveAt: now,
        createdAt: now,
        updatedAt: now,
        ...(example.assetId
          ? { kind: "video", fileAssetId: example.assetId }
          : {
              kind: "text",
              fileAssetId: null,
              essayBody: body,
              wordCount: countWords(essayBodyText(body)),
            }),
      });
    }
    // Backfill the video's copies on a seed made without storage.
    if (storage && example.assetId) {
      const [live] = await tx
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
        await seedVideoDerivatives(tx, storage, {
          bucket,
          prefix,
          fileId: example.assetId,
          now,
        });
      }
    }
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
  await db.transaction((tx) =>
    seedRaviEntries(tx, storage, { now, bucket, prefix })
  );
};
