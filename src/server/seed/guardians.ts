// Guardians seed data (#81): a verified guardian with an under-13 child
// they manage and a teen whose own login is linked to them, under fixed
// ids so links and journeys can name them; and a second teen with no
// guardian on the platform (#81), registered for Neighbours on My Street
// (NEIGH27) on a profile of their own, held until the guardian they named
// accepts their request. Dates of birth are counted back
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

import { createLinkToken } from "../crypto/link-token";
import {
  competition,
  guardian,
  guardianInvitation,
  guardianLink,
  participantProfile,
  registration,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import { storedGuardianDetails } from "../modules/guardians/guardian-record";
import {
  REQUESTED_GUARDIAN_NAME,
  storedTeenContact,
  TEEN_INVITATION_TOKEN,
} from "../modules/guardians/teen-contact";
import { invitationExpiresAt } from "../modules/institutions/domain/invitation";
import { ageGroupFor } from "../modules/registration/domain/age-group";
import {
  formatIsoDate,
  indianDateAt,
  parseIsoDate,
  type CalendarDate,
} from "../modules/registration/domain/calendar-date";
import { identityKeyInput } from "../modules/registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../modules/registration/domain/prepare-student";
import type { GuardianRelationship } from "../modules/registration/domain/student-details";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { ensureGrant } from "./access";
import { SEED_TERMS_COMPETITIONS } from "./competition-terms";
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
  /** A teen with no guardian on the platform, held for the one they asked. */
  heldTeen: {
    id: "01938a00-0000-7000-8000-000000008103",
    name: "Anika Shah",
    email: "teen2@example.test",
    profileId: "01938a00-0000-7000-8000-000000008123",
    participantCode: "FOA-P-265EED81",
    age: 15,
    registrationId: "01938a00-0000-7000-8000-000000008141",
    requestId: "01938a00-0000-7000-8000-000000008151",
    guardian: {
      name: "Neha Shah",
      email: "guardian2@example.test",
      relationship: "parent",
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

/**
 * The second teen's own profile, their NEIGH27 registration held for a
 * guardian, and their pending request to the guardian they named. Skipped
 * on a preview whose NEIGH27 has no group for them.
 */
async function ensureHeldTeen(deps: SeedDeps): Promise<void> {
  const now = deps.clock.now();
  const seed = SEED_GUARDIANS.heldTeen;
  const competitionId = SEED_TERMS_COMPETITIONS.paid;
  const [target] = await deps.db
    .select({ ageCutoffDate: competition.ageCutoffDate })
    .from(competition)
    .where(eq(competition.id, competitionId));
  const cutoff = target?.ageCutoffDate && parseIsoDate(target.ageCutoffDate);
  if (!cutoff) return;
  const account = await ensureVerifiedAccount(deps, seed);
  const dateOfBirth = bornYearsAgo(now, seed.age, 60);
  const placed = ageGroupFor(
    dateOfBirth,
    cutoff,
    await ageGroupsOf(deps.db, competitionId)
  );
  if (!placed.ok) return;

  await deps.db
    .insert(participantProfile)
    .values({
      id: seed.profileId,
      ownerKind: "self",
      ownerUserId: account.id,
      participantCode: seed.participantCode,
      fullName: seed.name,
      dobCiphertext: deps.cipher.encrypt(
        PROFILE_PURPOSE.dob,
        formatIsoDate(dateOfBirth)
      ),
      phoneCiphertext: deps.cipher.encrypt(
        PROFILE_PURPOSE.phone,
        "+919000000181"
      ),
      pinCode: "400001",
      city: "Mumbai",
      state: "Maharashtra",
      country: "IN",
      identityHash: deps.blindIndex.of(
        IDENTITY_HASH_PURPOSE,
        identityKeyInput(seed.name, dateOfBirth)
      ),
      createdBy: account.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  // Theirs, unless the teen's account was given another profile since.
  const [profile] = await deps.db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.id, seed.profileId),
        eq(participantProfile.ownerUserId, account.id),
        eq(participantProfile.ownerKind, "self")
      )
    );
  if (!profile) return;
  await deps.db
    .insert(registration)
    .values({
      id: seed.registrationId,
      participantProfileId: profile.id,
      competitionId,
      route: "individual",
      ageGroupId: placed.group.id,
      status: "pending_guardian",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const { token, tokenHash } = createLinkToken();
  await deps.db
    .insert(guardianInvitation)
    .values({
      id: seed.requestId,
      kind: "guardian_request",
      guardianId: null,
      requestedByUserId: account.id,
      inviteeNameCiphertext: deps.cipher.encrypt(
        REQUESTED_GUARDIAN_NAME,
        seed.guardian.name
      ),
      relationship: seed.guardian.relationship,
      participantProfileId: profile.id,
      ...storedTeenContact(deps, {
        channel: "email",
        address: seed.guardian.email,
      }),
      tokenHash,
      tokenCiphertext: deps.cipher.encrypt(TEEN_INVITATION_TOKEN, token),
      expiresAt: invitationExpiresAt(now),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

/**
 * The guardian, their under-13 child and their linked teen; then the
 * second teen held for the guardian they asked.
 */
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
  await ensureHeldTeen(deps);
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
    return {
      account,
      ...family,
      /** Seeds a verified guardian link for a pupil already on the roster. */
      async linkInstitutionRegistration(registrationId: string) {
        const [target] = await deps.db
          .select({ participantProfileId: registration.participantProfileId })
          .from(registration)
          .where(
            and(
              eq(registration.id, registrationId),
              eq(registration.route, "institution")
            )
          );
        if (!target) throw new Error("Expected an institution registration");
        const now = deps.clock.now();
        const id = uuidv7(now);
        await deps.db.insert(guardianLink).values({
          id,
          guardianId: family.guardianId,
          participantProfileId: target.participantProfileId,
          relationship: "parent",
          createdAt: now,
        });
        return {
          async revoke() {
            await deps.db
              .update(guardianLink)
              .set({ revokedAt: deps.clock.now() })
              .where(eq(guardianLink.id, id));
          },
        };
      },
    };
  };
}
