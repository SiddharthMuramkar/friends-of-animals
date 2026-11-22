// Guardians seed data (#81): a verified guardian with an under-13 child
// they manage and a teen whose own login is linked to them, under fixed
// ids so links and journeys can name them. Dates of birth are counted back
// from the clock the first time the seed runs, so the children are 8 and 15
// then and stay those people afterwards. Seed data sends nothing and writes
// no audit entry. Idempotent: rows already there are left alone.
//
// Also the `guardian` seed builder for tests: a verified guardian with the
// children asked for, none of them with a login.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import { guardian, guardianLink, participantProfile } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import { storedGuardianDetails } from "../modules/guardians/guardian-record";
import {
  formatIsoDate,
  indianDateAt,
  type CalendarDate,
} from "../modules/registration/domain/calendar-date";
import { identityKeyInput } from "../modules/registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../modules/registration/domain/prepare-student";
import type { GuardianRelationship } from "../modules/registration/domain/student-details";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { ensureGrant } from "./access";
import type { SeedDeps } from "./types";

export const SEED_GUARDIANS = {
  guardian: {
    id: "01938a00-0000-7000-8000-000000008101",
    name: "Kavita Desai",
    email: "guardian1@example.test",
    guardianId: "01938a00-0000-7000-8000-000000008111",
  },
  teen: {
    id: "01938a00-0000-7000-8000-000000008102",
    name: "Rohan Desai",
    email: "teen1@example.test",
  },
  children: {
    young: {
      profileId: "01938a00-0000-7000-8000-000000008121",
      linkId: "01938a00-0000-7000-8000-000000008131",
      fullName: "Isha Desai",
      age: 8,
    },
    teen: {
      profileId: "01938a00-0000-7000-8000-000000008122",
      linkId: "01938a00-0000-7000-8000-000000008132",
      fullName: "Rohan Desai",
      age: 15,
    },
  },
} as const;

/**
 * The date of birth of someone `years` old at `now` on India's calendar,
 * `daysPast` days after their birthday (negative: before it). Also for
 * the guardians tests and journeys.
 */
export function bornYearsAgo(
  now: Date,
  years: number,
  daysPast = 0
): CalendarDate {
  const today = indianDateAt(now);
  const date = new Date(
    Date.UTC(today.year - years, today.month - 1, today.day - daysPast)
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

type SeedChild = {
  profileId: string;
  linkId: string;
  fullName: string;
  dateOfBirth: CalendarDate;
  relationship: GuardianRelationship;
  loginUserId: string | null;
};

/**
 * A verified guardian record for `userId` (with the guardian role) and
 * their children, each a profile they own with an active link. Rows that
 * exist already are left alone; an unverified record already there is
 * refused. Returns the guardian record's id.
 */
async function ensureGuardianFamily(
  deps: SeedDeps,
  family: {
    userId: string;
    guardianId: string;
    fullName: string;
    children: readonly SeedChild[];
  }
): Promise<string> {
  const now = deps.clock.now();
  await deps.db
    .insert(guardian)
    .values({
      id: family.guardianId,
      userId: family.userId,
      ...storedGuardianDetails(deps, {
        fullName: family.fullName,
        phone: null,
      }),
      adultDeclaredAt: now,
      verifiedAt: now,
      verificationMethod: "email_otp",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [record] = await deps.db
    .select({ id: guardian.id, verifiedAt: guardian.verifiedAt })
    .from(guardian)
    .where(eq(guardian.userId, family.userId));
  if (!record) throw new Error("Could not create or find the guardian");
  // Someone who declared and never verified keeps their record as it is;
  // seed data doesn't vouch for them with the role or children.
  if (!record.verifiedAt) {
    throw new Error("This account's guardian record is not verified");
  }
  await ensureGrant(deps, family.userId, {
    role: "guardian",
    scope: { type: "global" },
  });

  for (const child of family.children) {
    await deps.db
      .insert(participantProfile)
      .values({
        id: child.profileId,
        ownerKind: "guardian",
        ownerUserId: family.userId,
        loginUserId: child.loginUserId,
        fullName: child.fullName,
        dobCiphertext: deps.cipher.encrypt(
          PROFILE_PURPOSE.dob,
          formatIsoDate(child.dateOfBirth)
        ),
        identityHash: deps.blindIndex.of(
          IDENTITY_HASH_PURPOSE,
          identityKeyInput(child.fullName, child.dateOfBirth)
        ),
        createdBy: family.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [profile] = await deps.db
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(
        and(
          eq(participantProfile.id, child.profileId),
          eq(participantProfile.ownerUserId, family.userId)
        )
      );
    if (!profile) continue;
    await deps.db
      .insert(guardianLink)
      .values({
        id: child.linkId,
        guardianId: record.id,
        participantProfileId: profile.id,
        relationship: child.relationship,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  return record.id;
}

/** The guardian, their under-13 child and their linked teen. */
export async function seedGuardians(deps: SeedDeps): Promise<void> {
  const now = deps.clock.now();
  const { guardian: parent, teen, children } = SEED_GUARDIANS;
  const account = await ensureVerifiedAccount(deps, parent);
  const teenAccount = await ensureVerifiedAccount(deps, teen);
  await ensureGrant(deps, teenAccount.id, {
    role: "participant",
    scope: { type: "global" },
  });
  await ensureGuardianFamily(deps, {
    userId: account.id,
    guardianId: parent.guardianId,
    fullName: parent.name,
    children: [
      {
        ...children.young,
        dateOfBirth: bornYearsAgo(now, children.young.age, 100),
        relationship: "parent",
        loginUserId: null,
      },
      {
        ...children.teen,
        dateOfBirth: bornYearsAgo(now, children.teen.age, 50),
        relationship: "parent",
        loginUserId: teenAccount.id,
      },
    ],
  });
}

export type SeedGuardianChild = {
  fullName: string;
  /** Completed years today, in India. */
  age: number;
  /** Defaults to parent. */
  relationship?: GuardianRelationship;
  /** A 13- to 17-year-old's own account, already linked; none by default. */
  loginUserId?: string | null;
};

/**
 * Makes `userId` a verified guardian (with the guardian role) of new
 * children of the given ages, in the order given: for the builder below
 * and the E2E fixture. No code, no audit entry.
 */
export async function addGuardianFamily(
  deps: SeedDeps,
  family: {
    userId: string;
    fullName: string;
    children: readonly SeedGuardianChild[];
  }
): Promise<{ guardianId: string; childIds: string[] }> {
  const now = deps.clock.now();
  const children = family.children.map((child, at) => ({
    profileId: uuidv7(new Date(now.getTime() + at)),
    linkId: uuidv7(now),
    fullName: child.fullName,
    dateOfBirth: bornYearsAgo(now, child.age, 30),
    relationship: child.relationship ?? ("parent" as const),
    loginUserId: child.loginUserId ?? null,
  }));
  const guardianId = await ensureGuardianFamily(deps, {
    userId: family.userId,
    guardianId: uuidv7(now),
    fullName: family.fullName,
    children,
  });
  return { guardianId, childIds: children.map((child) => child.profileId) };
}

/** Builds verified guardians with children, for tests. */
export function guardianBuilder(deps: SeedDeps) {
  let guardians = 0;
  return async function guardianWithChildren(options: {
    name?: string;
    email?: string;
    children: readonly SeedGuardianChild[];
  }) {
    guardians += 1;
    const name = options.name ?? `Test Guardian ${guardians}`;
    const account = await ensureVerifiedAccount(deps, {
      name,
      email: options.email ?? `test-guardian-${guardians}@example.test`,
    });
    const family = await addGuardianFamily(deps, {
      userId: account.id,
      fullName: name,
      children: options.children,
    });
    return { account, ...family };
  };
}
