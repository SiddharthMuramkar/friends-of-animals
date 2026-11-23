import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { hashLinkToken } from "../../../src/server/crypto/link-token";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { DEVELOPMENT_AUTH_SECRET } from "../../../src/server/identity/settings";
import { uuidv7 } from "../../../src/server/ids";
import { studentColumns } from "../../../src/server/modules/registration/student-profile";
import { systemClock } from "../../../src/server/ports/clock";
import {
  institutionRegistrationBuilder,
  SEED_REGISTRATIONS,
} from "../../../src/server/seed/registration";
import { freshEmail } from "./mailbox";
import { localSeedUrl } from "./seed-account";
import { test as base } from "./seed-registration";

export const STUDENT = "Tara Example";

/** Both projects use fresh synthetic students and the CI capture mailbox. */
export const test = base.extend<{
  consentStudent: {
    adminEmail: string;
    guardianEmail: string;
    institutionId: string;
    reference: string;
    setLinkExpiry: (token: string, expiresAt: Date) => Promise<void>;
  };
}>({
  consentStudent: async (
    { baseURL, seedVerifiedInstitution },
    use,
    testInfo
  ) => {
    const school = await seedVerifiedInstitution({
      adminName: "E2E Consent Coordinator",
      principalEmail: freshEmail(testInfo.project.name),
    });
    const url = localSeedUrl(baseURL);
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const crypto = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
    const competitionId = SEED_REGISTRATIONS.institution.competitionId;
    const guardianEmail = freshEmail(testInfo.project.name);
    let schoolRegistrationId: string | undefined;

    try {
      const registration = await institutionRegistrationBuilder({
        db,
        clock: systemClock,
        ...crypto,
        auth: { secret: DEVELOPMENT_AUTH_SECRET },
      })({ institutionId: school.id, competitionId });
      schoolRegistrationId = registration.id;

      const [ageGroup] = await db
        .select({ id: schema.competitionAgeGroup.id })
        .from(schema.competitionAgeGroup)
        .where(
          and(
            eq(schema.competitionAgeGroup.competitionId, competitionId),
            eq(schema.competitionAgeGroup.minAge, 9)
          )
        );
      if (!ageGroup)
        throw new Error("Missing the synthetic competition age group");
      const now = systemClock.now();
      const profileId = uuidv7(now);
      await db.transaction(async (tx) => {
        await tx.insert(schema.participantProfile).values({
          id: profileId,
          ownerKind: "institution",
          managingInstitutionId: school.id,
          identityHash: crypto.blindIndex.of("e2e.consent_student", profileId),
          ...studentColumns(crypto, {
            fullName: STUDENT,
            dateOfBirth: { year: 2016, month: 4, day: 12 },
            isMinor: true,
            grade: null,
            studentRef: null,
            address: null,
            pinCode: null,
            city: null,
            state: null,
            contact: {
              kind: "guardian",
              name: "Guardian Example",
              relationship: "parent",
              phone: "+919000008301",
              email: guardianEmail,
            },
          }),
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(schema.registration).values({
          id: uuidv7(now),
          participantProfileId: profileId,
          institutionRegistrationId: registration.id,
          competitionId,
          ageGroupId: ageGroup.id,
          route: "institution",
          status: "enrolled",
          createdAt: now,
          updatedAt: now,
        });
      });
      await use({
        adminEmail: school.adminEmail,
        guardianEmail,
        institutionId: school.id,
        reference: registration.reference,
        async setLinkExpiry(token, expiresAt) {
          // Age this fixture's link without altering a shared clock or another link.
          const day = 24 * 60 * 60 * 1000;
          const [expired] = await db
            .update(schema.consentLink)
            .set({
              sentAt: new Date(expiresAt.getTime() - 7 * day),
              expiresAt,
            })
            .where(
              and(
                eq(
                  schema.consentLink.institutionRegistrationId,
                  registration.id
                ),
                eq(schema.consentLink.tokenHash, hashLinkToken(token))
              )
            )
            .returning({ id: schema.consentLink.id });
          if (!expired) throw new Error("Could not age the synthetic link");
        },
      });
    } finally {
      try {
        if (schoolRegistrationId) {
          const fixtureLinks = eq(
            schema.consentLink.institutionRegistrationId,
            schoolRegistrationId
          );
          const rows = await db
            .select({ id: schema.consentLink.id })
            .from(schema.consentLink)
            .where(fixtureLinks);
          if (rows.length > 0) {
            await db.transaction(async (tx) => {
              await tx.delete(schema.consentEvent).where(
                inArray(
                  schema.consentEvent.consentLinkId,
                  rows.map(({ id }) => id)
                )
              );
              await tx.delete(schema.consentLink).where(fixtureLinks);
            });
          }
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});
