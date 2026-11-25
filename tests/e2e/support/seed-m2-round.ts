import { randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { uuidv7 } from "../../../src/server/ids";
import type { DigitalScope } from "../../../src/server/modules/competitions/domain/vocabulary";
import { processImageAsset } from "../../../src/server/modules/files/process-image";
import { PROFILE_PURPOSE } from "../../../src/server/modules/registration/student-profile";
import { openSchoolRounds } from "../../../src/server/modules/school-round/open-school-rounds";
import { systemClock } from "../../../src/server/ports/clock";
import { unconfiguredMedia } from "../../../src/server/ports/media";
import { sharpMediaProcessor } from "../../../src/server/ports/media-sharp";
import { localDiskStorageFor } from "../../../src/server/ports/storage-for";
import { localSeedUrl } from "./seed-account";
import { test as base } from "./seed-registration";

const chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const symbols = (length: number, alphabet = chars) =>
  Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");

type World = {
  adminEmail: string;
  institutionId: string;
  reference: string;
  code: string;
  students: { name: string; registrationNumber: string; email: string }[];
  openRound(): Promise<void>;
  /** The real media handler on the local store, as the dedicated worker would run it. */
  processUploads(): Promise<void>;
};

// A private competition and institution for each scope/project. CI's test
// server drains default outbox work through HTTP; only the separate media
// queue runs here, using the real image processor and disk adapter.
export const test = base.extend<{
  seedM2Round: (scope: DigitalScope) => Promise<World>;
}>({
  seedM2Round: async ({ baseURL, seedVerifiedInstitution }, use) => {
    const url = localSeedUrl(baseURL);
    const { cipher } = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const storage = localDiskStorageFor({
      APP_ENV: "local",
      APP_URL: baseURL!,
    });
    if (!storage) throw new Error("Local storage required for M2 fixture");
    const competitions: string[] = [];
    try {
      await use(async (scope) => {
        const school = await seedVerifiedInstitution({
          adminName: "M2 Coordinator",
          principalEmail: `principal-${randomUUID()}@example.test`,
        });
        const now = systemClock.now();
        const competitionId = uuidv7(now);
        const code = `M${symbols(5, "ABCDEFGHIJKLMNOPQRSTUVWXYZ")}27`;
        const ageGroupId = uuidv7(now);
        const institutionRegistrationId = uuidv7(now);
        const reference = `${code}-I-${symbols(5)}`;
        await db.insert(schema.competition).values({
          id: competitionId,
          code,
          slug: code.toLowerCase(),
          name: `M2 School Art ${code}`,
          status: "registration_closed",
          participation: "institutions",
          disciplines: ["drawing"],
          digitalScope: scope,
          shortlistPerCategory: 1,
          schoolPositions: 1,
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        competitions.push(competitionId);
        await db.insert(schema.competitionAgeGroup).values({
          id: ageGroupId,
          competitionId,
          label: "Group A",
          minAge: 18,
          maxAge: 30,
          position: 0,
        });
        await db.insert(schema.competitionCategory).values({
          id: uuidv7(now),
          competitionId,
          discipline: "drawing",
          ageGroupId,
        });
        await db.insert(schema.competitionKeyDate).values([
          {
            competitionId,
            kind: "registration_opens",
            at: new Date(now.getTime() - 3600_000),
          },
          {
            competitionId,
            kind: "registration_closes",
            at: new Date(now.getTime() - 60_000),
          },
          {
            competitionId,
            kind: "submissions_close",
            at: new Date(now.getTime() + 3600_000),
          },
          {
            competitionId,
            kind: "school_round_closes",
            at: new Date(now.getTime() + 7200_000),
          },
        ]);
        await db.insert(schema.institutionRegistration).values({
          id: institutionRegistrationId,
          institutionId: school.id,
          competitionId,
          reference,
          createdAt: now,
          updatedAt: now,
        });
        const students = [];
        for (const name of ["Ananya M2", "Ishaan M2"]) {
          const profileId = uuidv7(now);
          const registrationNumber = `${code}-R-${symbols(6)}`;
          const email = `${randomUUID()}@example.test`;
          await db.insert(schema.participantProfile).values({
            id: profileId,
            ownerKind: "institution",
            managingInstitutionId: school.id,
            fullName: name,
            dobCiphertext: cipher.encrypt(PROFILE_PURPOSE.dob, "2005-03-14"),
            emailCiphertext: cipher.encrypt(PROFILE_PURPOSE.email, email),
            identityHash: randomUUID(),
            createdAt: now,
            updatedAt: now,
          });
          await db.insert(schema.registration).values({
            id: uuidv7(now),
            participantProfileId: profileId,
            competitionId,
            route: "institution",
            institutionRegistrationId,
            ageGroupId,
            status: "confirmed",
            registrationNumber,
            createdAt: now,
            updatedAt: now,
          });
          students.push({ name, registrationNumber, email });
        }
        return {
          adminEmail: school.adminEmail,
          institutionId: school.id,
          reference,
          code,
          students,
          async openRound() {
            await db
              .update(schema.competitionKeyDate)
              .set({ at: new Date(systemClock.now().getTime() - 1_000) })
              .where(
                and(
                  eq(schema.competitionKeyDate.competitionId, competitionId),
                  eq(schema.competitionKeyDate.kind, "submissions_close")
                )
              );
            await db
              .update(schema.competition)
              .set({ status: "school_judging" })
              .where(eq(schema.competition.id, competitionId));
            await openSchoolRounds(
              { db, clock: systemClock },
              { competitionId },
              { kind: "system", process: "seed" }
            );
          },
          async processUploads() {
            const uploads = await db
              .select({ fileId: schema.entryFile.fileAssetId })
              .from(schema.entryFile)
              .innerJoin(
                schema.entry,
                eq(schema.entry.id, schema.entryFile.entryId)
              )
              .where(eq(schema.entry.competitionId, competitionId));
            for (const { fileId } of uploads) {
              if (fileId)
                await processImageAsset(
                  {
                    db,
                    clock: systemClock,
                    storage,
                    media: { ...unconfiguredMedia, ...sharpMediaProcessor() },
                  },
                  { attempt: 1, payload: { fileId } }
                );
            }
          },
        };
      });
    } finally {
      try {
        for (const competitionId of competitions) {
          const registrations = await db
            .select({
              id: schema.registration.id,
              profileId: schema.registration.participantProfileId,
            })
            .from(schema.registration)
            .where(eq(schema.registration.competitionId, competitionId));
          const grants = registrations.length
            ? await db
                .select({ id: schema.entryUploadGrant.fileAssetId })
                .from(schema.entryUploadGrant)
                .where(
                  inArray(
                    schema.entryUploadGrant.registrationId,
                    registrations.map((each) => each.id)
                  )
                )
            : [];
          const files = await db
            .select({ id: schema.entryFile.fileAssetId })
            .from(schema.entryFile)
            .innerJoin(
              schema.entry,
              eq(schema.entry.id, schema.entryFile.entryId)
            )
            .where(eq(schema.entry.competitionId, competitionId));
          const fileIds = [
            ...new Set([
              ...grants.map((each) => each.id),
              ...files.flatMap((each) => (each.id ? [each.id] : [])),
            ]),
          ];
          await db
            .delete(schema.schoolRound)
            .where(eq(schema.schoolRound.competitionId, competitionId));
          const refs = await db
            .select({ id: schema.institutionRegistration.id })
            .from(schema.institutionRegistration)
            .where(
              eq(schema.institutionRegistration.competitionId, competitionId)
            );
          if (refs.length)
            await db.delete(schema.conductCertification).where(
              inArray(
                schema.conductCertification.institutionRegistrationId,
                refs.map((each) => each.id)
              )
            );
          await db
            .delete(schema.entry)
            .where(eq(schema.entry.competitionId, competitionId));
          if (fileIds.length) {
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
          await db
            .delete(schema.registration)
            .where(eq(schema.registration.competitionId, competitionId));
          if (registrations.length)
            await db.delete(schema.participantProfile).where(
              inArray(
                schema.participantProfile.id,
                registrations.map((each) => each.profileId)
              )
            );
          await db
            .delete(schema.institutionRegistration)
            .where(
              eq(schema.institutionRegistration.competitionId, competitionId)
            );
          await db
            .delete(schema.competition)
            .where(eq(schema.competition.id, competitionId));
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});
