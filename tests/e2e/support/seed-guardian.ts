import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import { invitationPath } from "../../../src/lib/app-routes";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { createLinkToken } from "../../../src/server/crypto/link-token";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { DEVELOPMENT_AUTH_SECRET } from "../../../src/server/identity/settings";
import { uuidv7 } from "../../../src/server/ids";
import { invitationExpiresAt } from "../../../src/server/modules/institutions/domain/invitation";
import { REQUESTED_GUARDIAN_NAME } from "../../../src/server/modules/guardians/guardian-request";
import { storedTeenContact } from "../../../src/server/modules/guardians/teen-contact";
import { formatIsoDate } from "../../../src/server/modules/registration/domain/calendar-date";
import { identityKeyInput } from "../../../src/server/modules/registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../../../src/server/modules/registration/domain/prepare-student";
import { PROFILE_PURPOSE } from "../../../src/server/modules/registration/student-profile";
import { systemClock } from "../../../src/server/ports/clock";
import {
  addGuardianFamily,
  bornYearsAgo,
} from "../../../src/server/seed/guardians";
import { localSeedUrl, test as base } from "./seed-account";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SeededGuardian = {
  /** The guardian's address; they sign in by email code. */
  email: string;
  /** Their children's profile ids, in the order asked for. */
  childIds: string[];
  /** The path of the teen invitation asked for, if any. */
  invitation?: string;
};

export type SeedGuardian = (details: {
  name: string;
  children: {
    fullName: string;
    age: number;
    /** Gives the child an own login, linked, under this name. */
    loginName?: string;
  }[];
  /** A teen-login invitation for the first child, to this address. */
  invite?: { email: string; expired?: boolean };
}) => Promise<SeededGuardian>;

export type SeedGuardianRequest = (details: {
  teenName: string;
  /** The address the teen named for their guardian. */
  guardianEmail: string;
  expired?: boolean;
}) => Promise<{ request: string }>;

/**
 * `seedGuardian` (#81): a fresh account (through `seedAccount`) that is a
 * verified guardian with the children asked for, written as the preview
 * seed writes its guardian (src/server/seed/guardians.ts). A teen
 * invitation, if asked for, comes with its link, as its email would carry
 * it. `seedGuardianRequest` (81b): a fresh teen on a profile of their own
 * who asked a guardian, with the request's link. Local app servers only,
 * like `seedAccount`; the profiles (and any registrations made on them in
 * the test) go after the test, before the accounts.
 */
export const test = base.extend<{
  seedGuardian: SeedGuardian;
  seedGuardianRequest: SeedGuardianRequest;
}>({
  seedGuardianRequest: async ({ baseURL, seedAccount }, use) => {
    const url = localSeedUrl(baseURL);
    const crypto = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const profileIds: string[] = [];
    try {
      await use(async ({ teenName, guardianEmail, expired }) => {
        const email = await seedAccount({ name: teenName, grants: [] });
        try {
          const [teen] = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.email, email));
          if (!teen) throw new Error("No seeded account.");
          const now = systemClock.now();
          // An expired one was sent eight days ago, for seven.
          const sentAt = expired ? new Date(now.getTime() - 8 * DAY_MS) : now;
          const born = bornYearsAgo(now, 15, 30);
          const profileId = uuidv7(now);
          await db.insert(schema.participantProfile).values({
            id: profileId,
            ownerKind: "self",
            ownerUserId: teen.id,
            fullName: teenName,
            dobCiphertext: crypto.cipher.encrypt(
              PROFILE_PURPOSE.dob,
              formatIsoDate(born)
            ),
            identityHash: crypto.blindIndex.of(
              IDENTITY_HASH_PURPOSE,
              identityKeyInput(teenName, born)
            ),
            createdBy: teen.id,
            createdAt: sentAt,
            updatedAt: sentAt,
          });
          profileIds.push(profileId);
          const { token, tokenHash } = createLinkToken();
          await db.insert(schema.guardianInvitation).values({
            id: uuidv7(now),
            kind: "guardian_request",
            requestedByUserId: teen.id,
            inviteeNameCiphertext: crypto.cipher.encrypt(
              REQUESTED_GUARDIAN_NAME,
              "E2E Named Guardian"
            ),
            relationship: "parent",
            participantProfileId: profileId,
            ...storedTeenContact(crypto, {
              channel: "email",
              address: guardianEmail,
            }),
            tokenHash,
            expiresAt: invitationExpiresAt(sentAt),
            createdAt: sentAt,
            updatedAt: sentAt,
          });
          return { request: invitationPath(token) };
        } catch {
          // Drizzle errors can include bound values from the inserts.
          throw new Error("Could not seed a guardian request locally.");
        }
      });
    } finally {
      try {
        if (profileIds.length > 0) {
          // Requests go with the profiles.
          await db
            .delete(schema.participantProfile)
            .where(inArray(schema.participantProfile.id, profileIds));
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
  seedGuardian: async ({ baseURL, seedAccount }, use) => {
    const url = localSeedUrl(baseURL);
    const crypto = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
    const auth = {
      secret: process.env.BETTER_AUTH_SECRET || DEVELOPMENT_AUTH_SECRET,
    };
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const profileIds: string[] = [];

    async function userIdOf(email: string): Promise<string> {
      const [found] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email));
      if (!found) throw new Error("No seeded account.");
      return found.id;
    }

    try {
      await use(async ({ name, children, invite }) => {
        const email = await seedAccount({ name, grants: [] });
        const logins = await Promise.all(
          children.map(async (child) =>
            child.loginName
              ? userIdOf(
                  await seedAccount({
                    name: child.loginName,
                    grants: [
                      { role: "participant", scope: { type: "global" } },
                    ],
                  })
                )
              : null
          )
        );
        try {
          const userId = await userIdOf(email);
          const deps = { db, clock: systemClock, ...crypto, auth };
          const family = await addGuardianFamily(deps, {
            userId,
            fullName: name,
            children: children.map((child, at) => ({
              fullName: child.fullName,
              age: child.age,
              loginUserId: logins[at] ?? null,
            })),
          });
          profileIds.push(...family.childIds);
          const childId = family.childIds[0];
          if (!invite || !childId) return { email, childIds: family.childIds };

          const now = systemClock.now();
          // An expired one was sent eight days ago, for seven.
          const sentAt = invite.expired
            ? new Date(now.getTime() - 8 * DAY_MS)
            : now;
          const { token, tokenHash } = createLinkToken();
          await db.insert(schema.guardianInvitation).values({
            id: uuidv7(now),
            kind: "teen_login",
            guardianId: family.guardianId,
            participantProfileId: childId,
            ...storedTeenContact(crypto, {
              channel: "email",
              address: invite.email,
            }),
            tokenHash,
            expiresAt: invitationExpiresAt(sentAt),
            createdAt: sentAt,
            updatedAt: sentAt,
          });
          return {
            email,
            childIds: family.childIds,
            invitation: invitationPath(token),
          };
        } catch {
          // Drizzle errors can include bound values from the inserts.
          throw new Error("Could not seed a guardian on the local database.");
        }
      });
    } finally {
      try {
        if (profileIds.length > 0) {
          // A child registered in the test keeps a registration (81b),
          // which would hold the profile; links and invitations go with
          // the profiles.
          await db
            .delete(schema.registration)
            .where(
              inArray(schema.registration.participantProfileId, profileIds)
            );
          await db
            .delete(schema.participantProfile)
            .where(inArray(schema.participantProfile.id, profileIds));
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});
