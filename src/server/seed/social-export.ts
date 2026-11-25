import { and, eq } from "drizzle-orm";
import {
  competitionConsentDocument,
  consentDocument,
  consentEvent,
  socialExport,
} from "../db/schema";
import { galleryRow, liveGallerySource } from "../modules/gallery";
import { liveSocialSource } from "../modules/social-export/evidence";
import { queueStamp, renderStamp } from "../modules/stamping";
import { unconfiguredMedia } from "../ports/media";
import { seedStampProcessor } from "./stamped-art";
import { SEED_GALLERY } from "./gallery-samples";
import { SEED_SOCIAL_EXPORT } from "./social-export-samples";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_AUCTION_COMPETITION } from "./competitions";
import type { Seeder } from "./types";

/** Only the known synthetic preview artists: two distinct demo grants,
 * one queued example and one candidate, with actual stamped sample pixels.
 * A rerun never recreates an export removed by a consent withdrawal. */
export const seedSocialExport: Seeder = async (deps) => {
  const { db, clock, storage, cipher } = deps;
  if (!storage) return;
  const competitionId = SEED_AUCTION_COMPETITION.id;
  const [document] = await db
    .select()
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.purpose, "social_media"),
        eq(consentDocument.version, 1)
      )
    );
  if (!document) return;
  await db
    .insert(competitionConsentDocument)
    .values({
      competitionId,
      purpose: "social_media",
      consentDocumentId: document.id,
      attachedAt: clock.now(),
    })
    .onConflictDoNothing();
  for (const [itemId, grantId, minor] of [
    [SEED_GALLERY.items[0], SEED_SOCIAL_EXPORT.adultGrant, false],
    [SEED_GALLERY.items[2], SEED_SOCIAL_EXPORT.childGrant, true],
  ] as const) {
    const gallery = await galleryRow(deps, itemId);
    if (!gallery) continue;
    const source = await liveGallerySource(deps, gallery);
    if (!source || !source.image?.sampleIllustration) continue;
    const giverUserId = minor
      ? SEED_GUARDIANS.guardian.id
      : source.facts.profile.ownerUserId;
    if (!giverUserId) continue;
    const [inserted] = await db
      .insert(consentEvent)
      .values({
        id: grantId,
        subjectType: minor ? "participant_profile" : "user",
        subjectId: minor ? source.facts.profile.id : giverUserId,
        giverUserId,
        documentId: document.id,
        competitionId,
        purpose: "social_media",
        action: "given",
        method: "web_form",
        occurredAt: source.facts.registration.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: consentEvent.id });
    const social = await liveSocialSource(deps, gallery);
    if (!social.ok || social.socialConsentEventId !== grantId) continue;
    // Pre-render synthetic candidate art as well. Preview CI has no media
    // worker; production queues stamp work normally on the first request.
    const input = { fileId: social.fileId, variant: "social" as const };
    if (
      (await db.transaction((tx) => queueStamp(tx, clock, input))) ===
      "unavailable"
    )
      continue;
    await renderStamp(
      {
        db,
        clock,
        storage,
        media: { ...unconfiguredMedia, ...seedStampProcessor },
      },
      input
    );
    if (minor || !inserted) continue;
    const now = clock.now();
    await db
      .insert(socialExport)
      .values({
        id: SEED_SOCIAL_EXPORT.queued,
        galleryItemId: gallery.id,
        galleryConsentEventId: social.galleryConsentEventId,
        socialConsentEventId: social.socialConsentEventId,
        fileId: social.fileId,
        captionCiphertext: cipher.encrypt(
          "social_export.caption",
          [gallery.title, gallery.story].filter(Boolean).join("\n\n")
        ),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
};
