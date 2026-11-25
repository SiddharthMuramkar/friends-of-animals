import { randomInt, randomUUID } from "node:crypto";

import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { uuidv7 } from "../../../src/server/ids";
import { CONDUCT_STATEMENT_VERSION } from "../../../src/server/modules/institution-submissions/domain/conduct-statement";
import { PROFILE_PURPOSE } from "../../../src/server/modules/registration/student-profile";
import { systemClock } from "../../../src/server/ports/clock";
import { SEED_SCHOOL_ROUND } from "../../../src/server/seed/school-round";
import { localSeedUrl } from "./seed-account";
import { test as base } from "./seed-registration";

/** An open school round that only needs finalising. */
export type FinalisableRound = {
  institutionId: string;
  reference: string;
  /** Its authorised person, who may run the round; signs in by email code. */
  adminEmail: string;
};

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const symbols = (n: number) =>
  Array.from({ length: n }, () => CROCKFORD[randomInt(32)]).join("");

/**
 * `seedFinalisableRound` (#89): a fresh verified institution (through
 * `seedVerifiedInstitution`) registered for Kinder Skies (in school
 * judging) with one confirmed adult student who submitted nothing, its open
 * round with a panel of one, and its conduct certified: everything but the
 * judging attestation. Written as the round's own use cases would leave
 * it, so a journey can finalise without meeting the seeded school's round.
 * Local app servers only; its rows are removed after the test, before the
 * institution's.
 */
export const test = base.extend<{
  seedFinalisableRound: () => Promise<FinalisableRound>;
}>({
  seedFinalisableRound: async ({ baseURL, seedVerifiedInstitution }, use) => {
    const url = localSeedUrl(baseURL);
    const { cipher } = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const registrationIds: string[] = [];
    try {
      await use(async () => {
        const school = await seedVerifiedInstitution({
          adminName: "Round Coordinator",
          principalEmail: `principal-${randomUUID()}@example.test`,
        });
        const now = systemClock.now();
        const competitionId = SEED_SCHOOL_ROUND.competitionId;
        const [ageGroup] = await db
          .select({ id: schema.competitionAgeGroup.id })
          .from(schema.competitionAgeGroup)
          .where(eq(schema.competitionAgeGroup.competitionId, competitionId))
          .orderBy(asc(schema.competitionAgeGroup.position))
          .limit(1);
        if (!ageGroup) throw new Error("Kinder Skies is not seeded.");
        const registrationId = uuidv7(now);
        const reference = `SKIES26-I-${symbols(5)}`;
        await db.insert(schema.institutionRegistration).values({
          id: registrationId,
          institutionId: school.id,
          competitionId,
          reference,
          createdAt: now,
          updatedAt: now,
        });
        registrationIds.push(registrationId);
        const profileId = uuidv7(now);
        await db.insert(schema.participantProfile).values({
          id: profileId,
          ownerKind: "institution",
          managingInstitutionId: school.id,
          fullName: "Round Student",
          dobCiphertext: cipher.encrypt(PROFILE_PURPOSE.dob, "2005-03-14"),
          identityHash: randomUUID(),
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(schema.registration).values({
          id: uuidv7(now),
          participantProfileId: profileId,
          competitionId,
          route: "institution",
          institutionRegistrationId: registrationId,
          ageGroupId: ageGroup.id,
          status: "confirmed",
          registrationNumber: `SKIES26-R-${symbols(6)}`,
          createdAt: now,
          updatedAt: now,
        });
        const roundId = uuidv7(now);
        await db.insert(schema.schoolRound).values({
          id: roundId,
          competitionId,
          institutionRegistrationId: registrationId,
          status: "open",
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(schema.schoolRoundTransition).values({
          id: uuidv7(now),
          roundId,
          fromStatus: null,
          toStatus: "open",
          actorKind: "system",
          at: now,
        });
        await db.insert(schema.schoolRoundPanelMember).values({
          id: uuidv7(now),
          roundId,
          sortOrder: 0,
          fullName: "Lata Kulkarni",
          designation: "Art teacher",
        });
        await db.insert(schema.conductCertification).values({
          id: uuidv7(now),
          institutionRegistrationId: registrationId,
          certifiedAt: now,
          statementVersion: CONDUCT_STATEMENT_VERSION,
        });
        return {
          institutionId: school.id,
          reference,
          adminEmail: school.adminEmail,
        };
      });
    } finally {
      try {
        if (registrationIds.length > 0) {
          await db
            .delete(schema.schoolRound)
            .where(
              inArray(
                schema.schoolRound.institutionRegistrationId,
                registrationIds
              )
            );
          await db
            .delete(schema.conductCertification)
            .where(
              inArray(
                schema.conductCertification.institutionRegistrationId,
                registrationIds
              )
            );
          // The registrations, profiles and institution go with
          // seedVerifiedInstitution's own clean-up.
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});
