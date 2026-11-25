import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { uuidv7 } from "../../../src/server/ids";
import { sealListingDetails } from "../../../src/server/modules/directory/stored-listing";
import { systemClock } from "../../../src/server/ports/clock";
import { localSeedUrl, test as base } from "./seed-account";

/** A directory listing waiting for FOA, and the person who sent it. */
export type PendingListing = {
  id: string;
  slug: string;
  name: string;
  /** The registrant's address; they sign in by email code. */
  ownerEmail: string;
};

export type SeedPendingListing = (details: {
  ownerName: string;
}) => Promise<PendingListing>;

/**
 * `seedPendingListing`: a fresh account (through `seedAccount`) and a
 * listing it registered, pending verification, written the way the preview
 * seed writes its listings (src/server/seed/directory.ts). Journeys that
 * start after a registration use it instead of filling in the form again;
 * the form has its own journey. The name is unique, so the staff queue
 * shows exactly one row for it. Local app servers only, like
 * `seedAccount`, and removed after the test, before its account.
 */
export const test = base.extend<{ seedPendingListing: SeedPendingListing }>({
  seedPendingListing: async ({ baseURL, seedAccount }, use) => {
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
      await use(async ({ ownerName }) => {
        const ownerEmail = await seedAccount({ name: ownerName, grants: [] });
        const now = systemClock.now();
        const id = uuidv7(now);
        const tag = id.slice(-12);
        const name = `E2E Paws ${tag}`;
        const slug = `e2e-paws-${tag}`;
        try {
          const [owner] = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.email, ownerEmail));
          if (!owner) throw new Error("No seeded owner.");
          await db.insert(schema.directoryListing).values({
            id,
            slug,
            ...sealListingDetails(
              { cipher },
              {
                type: "ngo",
                name,
                description: "We rescue and treat street animals in Pune.",
                services: ["rescue", "veterinary_care"],
                address: "12 Lane 4, Koregaon Park",
                city: "Pune",
                state: "Maharashtra",
                pinCode: "411001",
                contactPhone: "+919000012790",
                contactEmail: "e2e-paws@example.test",
                website: null,
                publicContactFields: ["email"],
              }
            ),
            status: "pending_verification",
            statusChangedAt: now,
            ownerUserId: owner.id,
            createdAt: now,
            updatedAt: now,
          });
        } catch {
          // Drizzle errors can include bound values from the insert.
          throw new Error(
            "Could not seed a pending listing on the local database."
          );
        }
        listingIds.push(id);
        return { id, slug, name, ownerEmail };
      });
    } finally {
      try {
        if (listingIds.length > 0) {
          // Documents the journey uploaded name the owner's account, which
          // the account fixture removes next; the listing takes their rows.
          // Its grants name it only by scope id and go with the account.
          const documents = await db
            .select({ fileId: schema.directoryListingDocument.fileAssetId })
            .from(schema.directoryListingDocument)
            .where(
              inArray(schema.directoryListingDocument.listingId, listingIds)
            );
          if (documents.length > 0) {
            await db.delete(schema.fileAsset).where(
              inArray(
                schema.fileAsset.id,
                documents.map((document) => document.fileId)
              )
            );
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
