import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import type { E164Phone } from "../../../src/lib/phone";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { uuidv7 } from "../../../src/server/ids";
import { sealPrincipalContact } from "../../../src/server/modules/institutions/principal-contact";
import { systemClock } from "../../../src/server/ports/clock";
import { localSeedUrl, test as base } from "./seed-account";

/** A registration waiting for FOA, and the person who sent it. */
export type PendingInstitution = {
  id: string;
  name: string;
  /** The authorised person's address; they sign in by email code. */
  applicantEmail: string;
};

export type SeedPendingInstitution = (details: {
  applicantName: string;
}) => Promise<PendingInstitution>;

/**
 * `seedPendingInstitution`: a fresh account (through `seedAccount`) and an
 * institution it registered, pending verification, written the way the
 * preview seed writes its pending institution (src/server/seed/
 * institutions.ts). Journeys that start after a registration use it
 * instead of filling in the form again; the form has its own journey. The
 * name is unique, so the staff queue shows exactly one row for it. Local
 * app servers only, like `seedAccount`, and removed after the test, before
 * its account.
 */
export const test = base.extend<{
  seedPendingInstitution: SeedPendingInstitution;
}>({
  seedPendingInstitution: async ({ baseURL, seedAccount }, use) => {
    const url = localSeedUrl(baseURL);
    const { cipher } = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const institutionIds: string[] = [];

    try {
      await use(async ({ applicantName }) => {
        const applicantEmail = await seedAccount({
          name: applicantName,
          grants: [],
        });
        const now = systemClock.now();
        const id = uuidv7(now);
        const name = `E2E School ${id.slice(-12)}`;
        try {
          const [applicant] = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.email, applicantEmail));
          if (!applicant) throw new Error("No seeded applicant.");
          await db.insert(schema.institution).values({
            id,
            name,
            type: "school",
            address: "12 Lake Road, Sector 4",
            pinCode: "411001",
            city: "Pune",
            state: "Maharashtra",
            country: "India",
            contactEmail: "office@example.test",
            contactPhone: "+919000000221",
            principalName: "Seed Principal",
            ...sealPrincipalContact(
              { cipher },
              {
                principalEmail: "principal@example.test",
                principalPhone: "+919000000222" as E164Phone,
              }
            ),
            expectedParticipants: 240,
            status: "pending_verification",
            createdBy: applicant.id,
            createdAt: now,
            updatedAt: now,
          });
        } catch {
          // Drizzle errors can include bound values from the insert.
          throw new Error(
            "Could not seed a pending institution on the local database."
          );
        }
        institutionIds.push(id);
        return { id, name, applicantEmail };
      });
    } finally {
      try {
        if (institutionIds.length > 0) {
          await db
            .delete(schema.institution)
            .where(inArray(schema.institution.id, institutionIds));
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});
