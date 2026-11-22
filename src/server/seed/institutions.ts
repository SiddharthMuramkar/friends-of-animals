// Institution seed data (#73): one verified institution (the scope #59's
// seed grants point at), one pending verification and one rejected, so a
// preview's staff queue and the authorised person's page have something
// in each state. Placeholder details only: example.test addresses and
// numbers in a block no real subscriber holds. Loads under plain Node (the
// seed script): relative imports only, no "server-only".

import { institution } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import type { InstitutionDecision } from "../modules/institutions/domain/status";
import { sealPrincipalContact } from "../modules/institutions/principal-contact";
import type { E164Phone } from "../../lib/phone";
import { ensureGrant } from "./access";
import { SEED_SCOPES } from "./scopes";
import type { SeedDeps } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Fixed ids, so links and Seam 2 journeys can name them. */
export const SEED_INSTITUTIONS = {
  verified: {
    id: SEED_SCOPES.institution.id,
    name: SEED_SCOPES.institution.name,
    institutionCode: "FOA-I-5EED1",
    /** Its authorised person, and so its admin. */
    admin: {
      // 02xx are the competitions seeder's managers.
      id: "01938a00-0000-7000-8000-000000000301",
      name: "Kavita Joshi",
      email: "institution-admin@example.test",
    },
  },
  /** The applicant's second try, after the rejection below. */
  pending: {
    id: "01938a00-0000-7000-8000-000000001002",
    name: "Seed Valley College",
    applicant: {
      id: "01938a00-0000-7000-8000-000000000302",
      name: "Sanjay Patil",
      email: "institution-applicant@example.test",
    },
  },
  rejected: {
    id: "01938a00-0000-7000-8000-000000001003",
    name: "Seed Valley Coaching Centre",
  },
} as const;

type SeedRow = {
  id: string;
  name: string;
  type: "school" | "college" | "other";
  city: string;
  number: number;
  createdBy: string;
  registeredDaysAgo: number;
  decision?: { decision: InstitutionDecision; reason: string };
};

/** The row for `seed`, with its decision applied as of `now`. */
function rowFor(deps: SeedDeps, seed: SeedRow, now: Date) {
  const registeredAt = new Date(now.getTime() - seed.registeredDaysAgo * DAY);
  const phone = (offset: number) =>
    `+9190000002${seed.number}${offset}` as E164Phone;
  const base = {
    id: seed.id,
    name: seed.name,
    type: seed.type,
    address: `${seed.number} Seed Road`,
    pinCode: "411001",
    city: seed.city,
    state: "Maharashtra",
    country: "India",
    contactEmail: `office${seed.number}@example.test`,
    contactPhone: phone(1),
    principalName: `Seed Principal ${seed.number}`,
    ...sealPrincipalContact(deps, {
      principalEmail: `principal${seed.number}@example.test`,
      principalPhone: phone(2),
    }),
    expectedParticipants: 120 * seed.number,
    createdBy: seed.createdBy,
    createdAt: registeredAt,
    updatedAt: registeredAt,
  };
  if (!seed.decision)
    return { ...base, status: "pending_verification" as const };
  const decidedAt = new Date(registeredAt.getTime() + 2 * DAY);
  if (seed.decision.decision === "reject") {
    return {
      ...base,
      status: "rejected" as const,
      statusReason: seed.decision.reason,
      updatedAt: decidedAt,
    };
  }
  return {
    ...base,
    status: "verified" as const,
    statusReason: seed.decision.reason,
    institutionCode: SEED_INSTITUTIONS.verified.institutionCode,
    // Seed data, not a staff decision: it names no staff member.
    verifiedAt: decidedAt,
    updatedAt: decidedAt,
  };
}

/**
 * The three institutions, unless rows with their ids exist already (a
 * staff decision on a preview survives every later seed), and the
 * verified one's admin grant.
 */
export async function seedInstitutions(deps: SeedDeps): Promise<void> {
  const now = deps.clock.now();
  // By address, not by the fixed id: someone may have signed up with a
  // seeded address before the seed ran, and keeps their own id.
  const admin = await ensureVerifiedAccount(
    deps,
    SEED_INSTITUTIONS.verified.admin
  );
  const applicant = await ensureVerifiedAccount(
    deps,
    SEED_INSTITUTIONS.pending.applicant
  );
  const rows: SeedRow[] = [
    {
      id: SEED_INSTITUTIONS.verified.id,
      name: SEED_INSTITUTIONS.verified.name,
      type: "school",
      city: "Pune",
      number: 1,
      createdBy: admin.id,
      registeredDaysAgo: 60,
      decision: {
        decision: "verify",
        reason: "Seed data: confirmed with the principal",
      },
    },
    {
      id: SEED_INSTITUTIONS.rejected.id,
      name: SEED_INSTITUTIONS.rejected.name,
      type: "other",
      city: "Nashik",
      number: 3,
      createdBy: applicant.id,
      registeredDaysAgo: 30,
      decision: {
        decision: "reject",
        reason: "Seed data: a coaching centre, not a school or college",
      },
    },
    {
      id: SEED_INSTITUTIONS.pending.id,
      name: SEED_INSTITUTIONS.pending.name,
      type: "college",
      city: "Nashik",
      number: 2,
      createdBy: applicant.id,
      registeredDaysAgo: 2,
    },
  ];
  for (const seed of rows) {
    // Also skips a row its person can't hold: one open registration each.
    await deps.db
      .insert(institution)
      .values(rowFor(deps, seed, now))
      .onConflictDoNothing();
  }
  await ensureGrant(deps, admin.id, {
    role: "institution_admin",
    scope: { type: "institution", id: SEED_INSTITUTIONS.verified.id },
  });
}
