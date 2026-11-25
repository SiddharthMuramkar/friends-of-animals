import type { StoredDerivativeKind } from "../files/domain/derivatives";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedAuctionResults } from "@/test/seed-auction-results";
import { uuidv7 } from "@/server/ids";
import {
  competitionAgeGroup,
  competitionConsentDocument,
  consentEvent,
  entry,
  entryFile,
  fileAsset,
  fileDerivative,
  galleryItem,
  participantProfile,
  registration,
  user,
} from "@/server/db/schema";
import { seedGallery, SEED_GALLERY } from "@/server/seed/gallery";
import { derivativeKeyFor } from "../files/domain/media-work";
import { readAll } from "../files/process-image";
import { storageKeyFor, storagePrefixOf } from "../files/domain/storage-key";
import { consentCompetition } from "../consent/testing";

it("offers every live facet, including one found only after the first 24 items", async () => {
  const h = await createHarness();
  await seedAuctionResults(h.deps);
  await seedGallery(h.deps);
  const visitor = h.as(h.visitor());
  const older = await visitor.getPublicGalleryItem({
    itemId: SEED_GALLERY.items[0],
  });
  if (!older) throw new Error("Older gallery fixture missing");
  const [sample] = await h.db
    .select({
      item: galleryItem,
      entry,
      registration,
      profile: participantProfile,
      file: fileAsset,
    })
    .from(galleryItem)
    .innerJoin(entry, eq(galleryItem.entryId, entry.id))
    .innerJoin(registration, eq(entry.registrationId, registration.id))
    .innerJoin(
      participantProfile,
      eq(entry.participantProfileId, participantProfile.id)
    )
    .innerJoin(fileAsset, eq(galleryItem.fileId, fileAsset.id))
    .where(eq(galleryItem.id, older.itemId));
  if (!sample) throw new Error("Missing source fixture");
  const copies = await h.db
    .select()
    .from(fileDerivative)
    .where(eq(fileDerivative.fileAssetId, sample.file.id));
  const ready = await Promise.all(
    copies.map(async (copy) => ({
      copy,
      bytes: await readAll(
        await h.storage.read({ bucket: copy.bucket, key: copy.storageKey })
      ),
    }))
  );
  const newer = await consentCompetition(h, {
    fee: 0n,
    ageGroups: [{ label: "Newer adults", minAge: 18, maxAge: 99 }],
  });
  const [group] = await h.db
    .select()
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, newer.id));
  const [doc] = await h.db
    .select()
    .from(competitionConsentDocument)
    .where(eq(competitionConsentDocument.competitionId, newer.id))
    .then((rows) => rows.filter((row) => row.purpose === "public_display"));
  if (!group || !doc) throw new Error("Missing competition fixture");
  const now = h.clock.now();
  const id = () => uuidv7(now);
  const prefix = storagePrefixOf(sample.file);
  // Every creator, entry, original, grant and safe stamp is distinct, using
  // the actual synthetic preview bytes. Insert the independent fixture
  // rows in dependency order as one transaction, not 25 repeated
  // transactions and hundreds of individual DB round trips.
  const records = Array.from({ length: 25 }, (_, i) => {
    const accountId = id(),
      profileId = id(),
      registrationId = id(),
      entryId = id(),
      fileId = id(),
      grantId = id();
    const suffix = String(i).padStart(6, "0");
    for (const { copy, bytes } of ready)
      h.storage.plant({
        bucket: copy.bucket,
        key: derivativeKeyFor({
          prefix,
          fileId,
          kind: copy.kind as StoredDerivativeKind,
        }),
        bytes,
        contentType: copy.contentType,
      });
    return {
      account: {
        id: accountId,
        name: `Gallery creator ${i}`,
        email: `gallery-facet-creator-${i}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      profile: {
        ...sample.profile,
        id: profileId,
        ownerUserId: accountId,
        participantCode: `FOA-P-27${suffix}`,
        identityHash: `facets-${i}`,
        fullName: `Gallery creator ${i}`,
      },
      registration: {
        ...sample.registration,
        id: registrationId,
        participantProfileId: profileId,
        competitionId: newer.id,
        ageGroupId: group.id,
        registrationNumber: `${newer.code}-R-${suffix}`,
      },
      entry: {
        ...sample.entry,
        id: entryId,
        code: `${newer.code}-E-${suffix}`,
        registrationId,
        competitionId: newer.id,
        participantProfileId: profileId,
        discipline:
          i === 0 ? ("photography" as const) : sample.entry.discipline,
      },
      file: {
        ...sample.file,
        id: fileId,
        ownerUserId: accountId,
        storageKey: storageKeyFor({ prefix, purpose: "entry_image", fileId }),
      },
      entryFile: {
        id: id(),
        entryId,
        fileAssetId: fileId,
        attemptNumber: 1,
        kind: "image" as const,
        status: "live" as const,
        uploadCompletedAt: now,
        becameLiveAt: now,
        createdAt: now,
        updatedAt: now,
      },
      derivatives: copies.map((copy) => ({
        ...copy,
        id: id(),
        fileAssetId: fileId,
        storageKey: derivativeKeyFor({
          prefix,
          fileId,
          kind: copy.kind as StoredDerivativeKind,
        }),
      })),
      consent: {
        id: grantId,
        subjectType: "user" as const,
        subjectId: accountId,
        giverUserId: accountId,
        competitionId: newer.id,
        purpose: "public_display" as const,
        documentId: doc.consentDocumentId,
        action: "given" as const,
        method: "web_form" as const,
        occurredAt: now,
      },
      item: {
        ...sample.item,
        id: id(),
        entryId,
        fileId,
        consentEventId: grantId,
        featured: false,
      },
    };
  });
  await h.db.transaction(async (tx) => {
    await tx.insert(user).values(records.map((r) => r.account));
    await tx.insert(participantProfile).values(records.map((r) => r.profile));
    await tx.insert(registration).values(records.map((r) => r.registration));
    await tx.insert(entry).values(records.map((r) => r.entry));
    await tx.insert(fileAsset).values(records.map((r) => r.file));
    await tx.insert(entryFile).values(records.map((r) => r.entryFile));
    await tx
      .insert(fileDerivative)
      .values(records.flatMap((r) => r.derivatives));
    await tx.insert(consentEvent).values(records.map((r) => r.consent));
    await tx.insert(galleryItem).values(records.map((r) => r.item));
  });
  const first = await visitor.listPublicGallery();
  expect(first.items).toHaveLength(24);
  expect(
    first.items.every(
      (item) => item.competition.slug !== older.competition.slug
    )
  ).toBe(true);
  expect(first).toHaveProperty(
    "facets.competition",
    expect.arrayContaining([older.competition])
  );
  expect(first).toHaveProperty(
    "facets.category",
    expect.arrayContaining([older.category, "Newer adults"])
  );
  expect(first).toHaveProperty(
    "facets.recognition",
    expect.arrayContaining([older.recognition!.value, "none"])
  );
  const selected = await visitor.listPublicGallery({
    competition: older.competition.slug,
  });
  expect(selected.items.some((item) => item.itemId === older.itemId)).toBe(
    true
  );
  expect(selected).toHaveProperty("facets", first.facets);
  const later = await visitor.listPublicGallery({ cursor: first.nextCursor! });
  expect(later.items.some((item) => item.itemId === older.itemId)).toBe(true);
  expect(
    [...first.items, ...later.items]
      .filter((item) => item.competition.slug === newer.slug)
      .map((item) => item.itemId)
      .sort()
  ).toEqual(records.map((r) => r.item.id).sort());
  expect(later).toHaveProperty("facets", first.facets);
  // A facet backed only by one live grant disappears immediately after
  // withdrawal, even before the worker purges the published row.
  expect(first.facets.discipline).toContain("photography");
  const actor = await h.signIn(records[0]!.account);
  expect(
    await h.as(actor).withdrawMyPublicUseConsent({
      competitionId: newer.id,
      purpose: "public_display",
    })
  ).toMatchObject({ ok: true, changed: true });
  const withdrawn = await visitor.listPublicGallery();
  expect(withdrawn.facets.discipline).not.toContain("photography");
});
