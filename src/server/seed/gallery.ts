// Synthetic preview examples only. Never writes an original object. The
// demonstration art is explicitly labelled AI in the public projection.
import { and, eq } from "drizzle-orm";
import {
  competition,
  competitionConsentDocument,
  consentDocument,
  consentEvent,
  entry,
  entryFile,
  fileAsset,
  fileDerivative,
  galleryItem,
  galleryReport,
  participantProfile,
  registration,
} from "../db/schema";
import { uuidv7 } from "../ids";
import { seedFilesLocation } from "./files";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { derivativeKeyFor } from "../modules/files/domain/media-work";
import {
  liveEntryStampSource,
  queueStamp,
  renderStamp,
  stampedImage,
} from "../modules/stamping";
import { stampProcessor } from "../ports/media-stamp";
import { unconfiguredMedia } from "../ports/media";
import { eligibleEntry } from "../modules/gallery/evidence";
import { resizedArt } from "./resized-art";
import { SEED_AUCTION_COMPETITION } from "./competitions";
import { SEED_GUARDIANS } from "./guardians";
import type { Seeder } from "./types";
import { SEED_GALLERY, gallerySeedId as id } from "./gallery-samples";
export { SEED_GALLERY } from "./gallery-samples";
const examples = [
  {
    n: 1,
    title: "A refuge for birds",
    story: "Imagine a neighbourhood with clean water and shade for every bird.",
    art: "gallery-painting",
  },
  {
    n: 2,
    title: "A kinder street",
    story: "A shared street where animals and people can rest safely.",
    art: "gallery-drawing",
  },
  {
    n: 4,
    title: "Our friends",
    story: "Kindness starts with the small creatures we meet every day.",
    art: "gallery-craft",
  },
  {
    n: 3,
    title: "The garden that grew",
    story: "A garden that welcomes every creature.",
    art: "gallery-photo",
  },
] as const;
export const seedGallery: Seeder = async (deps) => {
  const { db, clock, storage } = deps;
  // Tests without a store and previews without R2 do not fabricate ready
  // artwork. A real store is required to show any gallery image.
  if (!storage) return;
  const [comp] = await db
    .select()
    .from(competition)
    .where(eq(competition.id, SEED_AUCTION_COMPETITION.id));
  if (!comp?.publicDisplay) return;
  const [doc] = await db
    .select()
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.purpose, "public_display"),
        eq(consentDocument.version, 1)
      )
    );
  if (!doc) return;
  const now = clock.now();
  await db
    .insert(competitionConsentDocument)
    .values({
      competitionId: comp.id,
      purpose: "public_display",
      consentDocumentId: doc.id,
      attachedAt: now,
    })
    .onConflictDoNothing();
  for (const [i, example] of examples.entries()) {
    const itemId = SEED_GALLERY.items[i]!;
    const [existing] = await db
      .select({ id: galleryItem.id })
      .from(galleryItem)
      .where(eq(galleryItem.id, itemId));
    if (existing) continue;
    const [artist] = await db
      .select({ entry, profile: participantProfile, registration })
      .from(entry)
      .innerJoin(
        participantProfile,
        eq(entry.participantProfileId, participantProfile.id)
      )
      .innerJoin(registration, eq(entry.registrationId, registration.id))
      .where(eq(entry.code, `AUCT27-E-5EED0${example.n}`));
    if (!artist) continue;
    const minor = example.n === 2 || example.n === 4;
    const giver = minor
      ? SEED_GUARDIANS.guardian.id
      : artist.profile.ownerUserId;
    if (!giver) continue;
    const grant = {
      subjectType: minor ? ("participant_profile" as const) : ("user" as const),
      subjectId: minor ? artist.profile.id : giver,
      giverUserId: giver,
      documentId: doc.id,
      competitionId: comp.id,
      action: "given" as const,
      method: "web_form" as const,
      occurredAt: artist.registration.createdAt,
    };
    await db
      .insert(consentEvent)
      .values({ id: id(20 + i), ...grant, purpose: "public_display" })
      .onConflictDoNothing();
    if (example.n === 4) {
      // Only the fixed demo child gets these fictional credit facts; the
      // explicit opt-ins refer to the same public-display document.
      if (!artist.profile.schoolName && !artist.profile.city)
        await db
          .update(participantProfile)
          .set({ schoolName: "Sample Green School", city: "Mumbai" })
          .where(eq(participantProfile.id, artist.profile.id));
      await db
        .insert(consentEvent)
        .values([
          { id: id(30), ...grant, purpose: "display_school" },
          { id: id(31), ...grant, purpose: "display_city" },
        ])
        .onConflictDoNothing();
    }
    const prior = await liveEntryStampSource(db, artist.entry.id);
    const fileId = prior ?? SEED_GALLERY.originalFileIds[i]!;
    if (!prior) {
      const { bucket, keyPrefix: prefix } = seedFilesLocation();
      const copy = (
        await resizedArt(
          new URL(
            `../../assets/site-art/gallery/${example.art}.webp`,
            import.meta.url
          ),
          ["display_1600"]
        )
      )[0]!;
      await db.transaction(async (tx) => {
        await tx
          .insert(fileAsset)
          .values({
            id: fileId,
            ownerUserId: giver,
            purpose: "entry_image",
            contentType: "image/webp",
            sizeBytes: copy.bytes.length,
            bucket,
            storageKey: storageKeyFor({
              prefix,
              purpose: "entry_image",
              fileId,
            }),
            status: "clean",
            scanResult: "generated_sample_illustration",
            uploadedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        await tx
          .insert(entryFile)
          .values({
            id: id(110 + i),
            entryId: artist.entry.id,
            fileAssetId: fileId,
            attemptNumber: 1,
            kind: "image",
            status: "live",
            uploadCompletedAt: now,
            becameLiveAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        const key = derivativeKeyFor({ prefix, fileId, kind: "display_1600" });
        await storage.write({
          bucket,
          key,
          body: copy.bytes,
          contentType: "image/webp",
        });
        await tx
          .insert(fileDerivative)
          .values({
            id: uuidv7(now),
            fileAssetId: fileId,
            kind: "display_1600",
            bucket,
            storageKey: key,
            contentType: copy.contentType,
            sizeBytes: copy.bytes.length,
            width: copy.width,
            height: copy.height,
            createdAt: now,
          })
          .onConflictDoNothing();
      });
    }
    const source = await eligibleEntry(deps, artist.entry.id);
    if (
      !source.eligible ||
      ![
        id(20 + i),
        `01938a00-0000-7000-8000-000000099${String(example.n + 10).padStart(3, "0")}`,
      ].includes(source.consentEventId) ||
      source.fileId !== fileId
    )
      continue;
    if (!source.image) {
      const queued = await db.transaction((tx) =>
        queueStamp(tx, clock, { fileId, variant: "gallery" })
      );
      if (queued === "unavailable") continue;
      await renderStamp(
        {
          db,
          clock,
          storage,
          media: { ...unconfiguredMedia, ...stampProcessor() },
        },
        { fileId, variant: "gallery" }
      );
    }
    if (!(await stampedImage(deps, { fileId, variant: "gallery" }))) continue;
    await db
      .insert(galleryItem)
      .values({
        id: itemId,
        entryId: artist.entry.id,
        consentEventId: source.consentEventId,
        fileId,
        status: i === 3 ? "draft" : "published",
        title: example.title,
        story: example.story,
        reviewed: i !== 3,
        featured: i < 2,
        publishedAt: i === 3 ? null : now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
  const [first] = await db
    .select({ id: galleryItem.id })
    .from(galleryItem)
    .where(eq(galleryItem.id, SEED_GALLERY.items[0]));
  if (first)
    await db
      .insert(galleryReport)
      .values({
        id: SEED_GALLERY.report,
        itemId: first.id,
        status: "open",
        reason: "other",
        detailsCiphertext: deps.cipher.encrypt(
          "gallery_report.details",
          "Sample report for staff review"
        ),
        createdAt: now,
      })
      .onConflictDoNothing();
  for (const n of [1, 2]) {
    const itemId = SEED_GALLERY.items[n]!;
    const [sample] = await db
      .select({ id: galleryItem.id })
      .from(galleryItem)
      .where(eq(galleryItem.id, itemId));
    if (sample)
      await db
        .insert(galleryReport)
        .values({
          id: id(201 + n),
          itemId,
          status: n === 1 ? "open" : "dismissed",
          reason: "wrong_credit",
          createdAt: now,
          ...(n === 2 ? { handledAt: now } : {}),
        })
        .onConflictDoNothing();
  }
};
