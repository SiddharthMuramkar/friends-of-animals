import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { uuidv7 } from "../../../src/server/ids";
import { detailsColumns } from "../../../src/server/modules/adoption/stored";
import { sealListingDetails } from "../../../src/server/modules/directory/stored-listing";
import { systemClock } from "../../../src/server/ports/clock";
import { localSeedUrl, test as base } from "./seed-account";

/** A verified directory listing, its representative, and a ready draft. */
export type AdoptionWorld = {
  listingId: string;
  listingName: string;
  /** The representative's address; they sign in by email code. */
  ownerEmail: string;
  /** A draft animal with one photo whose copies are made (rows only). */
  draft: { id: string; slug: string; name: string };
};

/**
 * `{ published: true }` (#130) publishes the animal instead of leaving it a
 * draft, so a journey can apply for it straight away.
 */
export type SeedAdoptionWorld = (options?: {
  published?: boolean;
}) => Promise<AdoptionWorld>;

/**
 * `seedAdoptionWorld`: a fresh representative (through `seedAccount`) of a
 * fresh verified directory listing, written the way the preview seed
 * writes them (src/server/seed/directory.ts, ./adoption.ts), and a draft
 * animal whose photo counts as ready. CI's journeys run no worker-media,
 * so a photo uploaded in the browser is scanned but never resized; the
 * ready draft is how a journey publishes. Its copies' objects aren't
 * written (the server's disk store is out of reach), so its picture
 * doesn't load; its text alternative still shows. Local app servers only,
 * and removed after the test, before its account.
 */
export const test = base.extend<{ seedAdoptionWorld: SeedAdoptionWorld }>({
  seedAdoptionWorld: async ({ baseURL, seedAccount }, use) => {
    const url = localSeedUrl(baseURL);
    const { cipher } = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const listingIds: string[] = [];

    try {
      await use(async ({ published = false } = {}) => {
        const now = systemClock.now();
        const listingId = uuidv7(now);
        const tag = listingId.slice(-12);
        const listingName = `E2E Shelter ${tag}`;
        const ownerEmail = await seedAccount({
          name: "Nisha Kulkarni",
          grants: [
            {
              role: "organisation_representative",
              scope: { type: "organisation", id: listingId },
            },
          ],
        });
        const draftId = uuidv7(now);
        const fileId = uuidv7(now);
        const draft = {
          id: draftId,
          slug: `e2e-tommy-${tag}`,
          name: `Tommy ${tag.slice(-4)}`,
        };
        try {
          const [owner] = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(inArray(schema.user.email, [ownerEmail]));
          if (!owner) throw new Error("No seeded owner.");
          await db.transaction(async (tx) => {
            await tx.insert(schema.directoryListing).values({
              id: listingId,
              slug: `e2e-shelter-${tag}`,
              ...sealListingDetails(
                { cipher },
                {
                  type: "shelter",
                  name: listingName,
                  description: "We shelter and rehome animals in Pune.",
                  services: ["shelter", "adoption"],
                  address: "3 Seed Lane, Aundh",
                  city: "Pune",
                  state: "Maharashtra",
                  pinCode: "411007",
                  contactPhone: "+919000012793",
                  contactEmail: "e2e-shelter@example.test",
                  website: null,
                  publicContactFields: ["email"],
                }
              ),
              status: "verified",
              statusChangedAt: now,
              verifiedAt: now,
              ownerUserId: owner.id,
              createdAt: now,
              updatedAt: now,
            });
            listingIds.push(listingId);
            await tx.insert(schema.adoptionListing).values({
              id: draftId,
              directoryListingId: listingId,
              slug: draft.slug,
              ...detailsColumns(
                {
                  name: draft.name,
                  species: "dog",
                  breed: "Indie",
                  sex: "male",
                  size: "medium",
                  colour: "Black and tan",
                  age: { years: 3, months: 0 },
                  sterilised: true,
                  about: "Gentle and house-trained.",
                  healthNotes: "Healthy.",
                  vaccinationNotes: "Anti-rabies, up to date.",
                  conditions: "A home visit before the adoption.",
                  state: "maharashtra",
                  city: "Pune",
                  pinCode: "411007",
                },
                now
              ),
              status: published ? "published" : "draft",
              publishedAt: published ? now : null,
              createdByUserId: owner.id,
              createdAt: now,
              updatedAt: now,
            });
            await tx.insert(schema.fileAsset).values({
              id: fileId,
              ownerUserId: owner.id,
              purpose: "adoption_photo",
              contentType: "image/jpeg",
              sizeBytes: 1000,
              bucket: "e2e",
              storageKey: `e2e/adoption_photo/${fileId}`,
              status: "clean",
              uploadedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            await tx.insert(schema.fileProcessing).values({
              fileAssetId: fileId,
              status: "done",
              queuedAt: now,
              finishedAt: now,
              updatedAt: now,
            });
            for (const [kind, width] of [
              ["thumb_320", 320],
              ["display_800", 800],
              ["display_1600", 1600],
            ] as const) {
              await tx.insert(schema.fileDerivative).values({
                id: uuidv7(now),
                fileAssetId: fileId,
                kind,
                bucket: "e2e",
                storageKey: `e2e/derived/${fileId}/${kind}.webp`,
                contentType: "image/webp",
                width,
                height: (width * 3) / 4,
                sizeBytes: 1000,
                createdAt: now,
              });
            }
            await tx.insert(schema.adoptionListingPhoto).values({
              id: uuidv7(now),
              listingId: draftId,
              fileAssetId: fileId,
              position: 1,
              altText: `${draft.name} lying in the sun`,
              createdAt: now,
            });
          });
        } catch {
          // Drizzle errors can include bound values from the insert.
          throw new Error(
            "Could not seed an adoption world on the local database."
          );
        }
        return { listingId, listingName, ownerEmail, draft };
      });
    } finally {
      try {
        if (listingIds.length > 0) {
          // Photos name files the representative's account owns, which the
          // account fixture removes next: their copies, processing rows and
          // files go first, then the animals and the listing.
          const animals = await db
            .select({ id: schema.adoptionListing.id })
            .from(schema.adoptionListing)
            .where(
              inArray(schema.adoptionListing.directoryListingId, listingIds)
            );
          const animalIds = animals.map((animal) => animal.id);
          const photos =
            animalIds.length === 0
              ? []
              : await db
                  .select({ fileId: schema.adoptionListingPhoto.fileAssetId })
                  .from(schema.adoptionListingPhoto)
                  .where(
                    inArray(schema.adoptionListingPhoto.listingId, animalIds)
                  );
          const fileIds = photos.map((photo) => photo.fileId);
          if (fileIds.length > 0) {
            await db
              .delete(schema.fileDerivative)
              .where(inArray(schema.fileDerivative.fileAssetId, fileIds));
            await db
              .delete(schema.fileProcessing)
              .where(inArray(schema.fileProcessing.fileAssetId, fileIds));
            await db
              .delete(schema.fileAsset)
              .where(inArray(schema.fileAsset.id, fileIds));
          }
          if (animalIds.length > 0) {
            // Applications (#130) hold their animal; their stories go with
            // them.
            await db
              .delete(schema.adoptionApplication)
              .where(
                inArray(schema.adoptionApplication.adoptionListingId, animalIds)
              );
            await db
              .delete(schema.adoptionListing)
              .where(inArray(schema.adoptionListing.id, animalIds));
          }
          await db
            .delete(schema.directoryListing)
            .where(inArray(schema.directoryListing.id, listingIds));
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});
