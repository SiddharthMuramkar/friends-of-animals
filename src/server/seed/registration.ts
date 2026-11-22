// Registration seed data (#75): the seeded verified institution registered
// for the seeded open competition (NEIGH27), under a fixed id and
// reference so links and journeys can name them. Seed data sends nothing
// and names nobody as having registered. Also the
// `h.seed.institutionRegistration()` builder.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { and, eq } from "drizzle-orm";

import {
  competition,
  institution,
  INSTITUTION_REGISTRATION_REFERENCE_UNIQUE,
  institutionRegistration,
} from "../db/schema";
import { uuidv7 } from "../ids";
import { withUniqueCode } from "../modules/codes/codes";
import { REFERENCE_SYMBOL_COUNT } from "../modules/registration/domain/institution-registration-reference";
import { SEED_INSTITUTIONS } from "./institutions";
import type { SeedDeps } from "./types";

export const SEED_REGISTRATIONS = {
  /** The verified institution, for "Neighbours on My Street". */
  institution: {
    id: "01938a00-0000-7000-8000-000000005001",
    institutionId: SEED_INSTITUTIONS.verified.id,
    // The competitions seed's open competition, NEIGH27.
    competitionId: "01938a00-0000-7000-8000-000000002101",
    reference: "NEIGH27-I-5EED1",
  },
} as const;

/**
 * The registration, after the institutions and competitions seeds, while
 * its institution is verified. Running again changes nothing.
 */
export async function seedRegistrations(deps: SeedDeps): Promise<void> {
  const seed = SEED_REGISTRATIONS.institution;
  const [verified] = await deps.db
    .select({ id: institution.id })
    .from(institution)
    .where(
      and(
        eq(institution.id, seed.institutionId),
        eq(institution.status, "verified")
      )
    );
  const [open] = await deps.db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.id, seed.competitionId));
  if (!verified || !open) return;
  const now = deps.clock.now();
  // Also skips it if someone registered the pair on the preview already.
  await deps.db
    .insert(institutionRegistration)
    .values({ ...seed, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
}

/**
 * The `h.seed.institutionRegistration()` builder: registers an
 * institution for a competition as seed data, with no checks, no message
 * and no audit entry. `registeredBy` defaults to nobody.
 */
export function institutionRegistrationBuilder(deps: SeedDeps) {
  return async (options: {
    institutionId: string;
    competitionId: string;
    registeredBy?: string;
  }): Promise<{ id: string; reference: string }> => {
    const [target] = await deps.db
      .select({ code: competition.code })
      .from(competition)
      .where(eq(competition.id, options.competitionId));
    if (!target) {
      throw new Error(`No competition ${options.competitionId}`);
    }
    const now = deps.clock.now();
    const id = uuidv7(now);
    const reference = await withUniqueCode(
      {
        format: { prefix: `${target.code}-I-`, length: REFERENCE_SYMBOL_COUNT },
        constraint: INSTITUTION_REGISTRATION_REFERENCE_UNIQUE,
      },
      // A savepoint per try, so a taken reference can't abort a caller's
      // transaction.
      (code) =>
        deps.db.transaction(async (tx) => {
          await tx.insert(institutionRegistration).values({
            id,
            institutionId: options.institutionId,
            competitionId: options.competitionId,
            reference: code,
            registeredBy: options.registeredBy ?? null,
            createdAt: now,
            updatedAt: now,
          });
          return code;
        })
    );
    return { id, reference };
  };
}
