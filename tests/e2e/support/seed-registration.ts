import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import type { E164Phone } from "../../../src/lib/phone";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { uuidv7 } from "../../../src/server/ids";
import {
  generateCode,
  INSTITUTION_CODE,
} from "../../../src/server/modules/codes/codes";
import { sealPrincipalContact } from "../../../src/server/modules/institutions/principal-contact";
import { systemClock } from "../../../src/server/ports/clock";
import { localSeedUrl } from "./seed-account";
import { test as base } from "./seed-institution";

/** A verified institution of its own, and who acts for it. */
export type VerifiedInstitution = {
  id: string;
  name: string;
  /** Its authorised person's address; they sign in by email code. */
  adminEmail: string;
  /** Where its principal reads email. */
  principalEmail: string;
};

export type SeedVerifiedInstitution = (details: {
  adminName: string;
  principalEmail: string;
}) => Promise<VerifiedInstitution>;

/**
 * `seedVerifiedInstitution` (#75): a fresh account (through `seedAccount`)
 * holding institution_admin at a fresh verified institution, written as
 * the preview seed writes its verified institution
 * (src/server/seed/institutions.ts). The seeded institution is already
 * registered for the seeded open competition, so a journey that registers
 * needs one of its own. Local app servers only, like `seedAccount`; its
 * students, its registrations and then the institution are removed after
 * the test, before its account.
 */
export const test = base.extend<{
  seedVerifiedInstitution: SeedVerifiedInstitution;
}>({
  seedVerifiedInstitution: async ({ baseURL, seedAccount }, use) => {
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
      await use(async ({ adminName, principalEmail }) => {
        const now = systemClock.now();
        const id = uuidv7(now);
        const name = `E2E School ${id.slice(-12)}`;
        const adminEmail = await seedAccount({
          name: adminName,
          grants: [
            { role: "institution_admin", scope: { type: "institution", id } },
          ],
        });
        try {
          const [admin] = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.email, adminEmail));
          if (!admin) throw new Error("No seeded authorised person.");
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
            contactPhone: "+919000000231",
            principalName: "Seed Principal",
            ...sealPrincipalContact(
              { cipher },
              {
                principalEmail,
                principalPhone: "+919000000232" as E164Phone,
              }
            ),
            expectedParticipants: 240,
            status: "verified",
            statusReason: "E2E fixture: confirmed with the principal",
            institutionCode: generateCode(INSTITUTION_CODE),
            verifiedAt: now,
            createdBy: admin.id,
            createdAt: now,
            updatedAt: now,
          });
        } catch {
          // Drizzle errors can include bound values from the insert.
          throw new Error(
            "Could not seed a verified institution on the local database."
          );
        }
        institutionIds.push(id);
        return { id, name, adminEmail, principalEmail };
      });
    } finally {
      try {
        if (institutionIds.length > 0) {
          // Students enrolled under its registrations (#75) first.
          const registrations = await db
            .select({ id: schema.institutionRegistration.id })
            .from(schema.institutionRegistration)
            .where(
              inArray(
                schema.institutionRegistration.institutionId,
                institutionIds
              )
            );
          if (registrations.length > 0) {
            await db.delete(schema.registration).where(
              inArray(
                schema.registration.institutionRegistrationId,
                registrations.map((each) => each.id)
              )
            );
          }
          await db
            .delete(schema.participantProfile)
            .where(
              inArray(
                schema.participantProfile.managingInstitutionId,
                institutionIds
              )
            );
          await db
            .delete(schema.institutionRegistration)
            .where(
              inArray(
                schema.institutionRegistration.institutionId,
                institutionIds
              )
            );
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
