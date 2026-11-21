// Coordinators seed data (#74): on the seeded verified institution, a
// coordinator and one invitation still waiting, under fixed ids so links
// and journeys can name them. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import { institution, institutionInvitation } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { invitationExpiresAt } from "../institutions/domain/invitation";
import { storedInvitee } from "../institutions/coordinators/invitee";
import { createLinkToken } from "../tokens/link-token";
import { ensureGrant } from "./access";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_SCOPES } from "./scopes";
import type { SeedDeps } from "./types";

export const SEED_COORDINATORS = {
  institution: SEED_SCOPES.institution,
  /** PROVISIONAL until #73 seeds the institution and its authorised person. */
  principal: {
    id: "01938a00-0000-7000-8000-000000000201",
    name: "Seed Principal",
    email: "principal@example.test",
  },
  /** Member 1 already coordinates there (./access.ts); kept so here too. */
  coordinator: SEED_ACCOUNTS.members[0],
  invitation: {
    id: "01938a00-0000-7000-8000-000000004001",
    email: "invited-teacher@example.test",
  },
} as const;

/**
 * PROVISIONAL stand-in for #73's institutions seed: the seeded institution,
 * verified, with its authorised person. Drop it once #73's seeder makes
 * them (it runs before this one).
 */
async function ensureSeedInstitution(deps: SeedDeps): Promise<string> {
  const now = deps.clock.now();
  await deps.db
    .insert(institution)
    .values({
      id: SEED_COORDINATORS.institution.id,
      name: SEED_COORDINATORS.institution.name,
      status: "verified",
      createdAt: now,
    })
    .onConflictDoNothing();
  const principal = await ensureVerifiedAccount(
    deps,
    SEED_COORDINATORS.principal
  );
  await ensureGrant(deps, principal.id, {
    role: "institution_admin",
    scope: { type: "institution", id: SEED_COORDINATORS.institution.id },
  });
  return principal.id;
}

/** The coordinator and the waiting invitation, after the access seed. */
export async function seedCoordinators(deps: SeedDeps): Promise<void> {
  const principalId = await ensureSeedInstitution(deps);
  const institutionId = SEED_COORDINATORS.institution.id;
  const coordinator = await ensureVerifiedAccount(
    deps,
    SEED_COORDINATORS.coordinator
  );
  await ensureGrant(deps, coordinator.id, {
    role: "institution_coordinator",
    scope: { type: "institution", id: institutionId },
  });

  // Seed data sends nothing, so the link's token is thrown away: only its
  // hash is kept, and the invitation shows on the list as waiting (expired
  // after seven days on a long-lived preview).
  const now = deps.clock.now();
  await deps.db
    .insert(institutionInvitation)
    .values({
      id: SEED_COORDINATORS.invitation.id,
      institutionId,
      ...storedInvitee(deps, {
        channel: "email",
        address: SEED_COORDINATORS.invitation.email,
      }),
      tokenHash: createLinkToken().tokenHash,
      invitedByUserId: principalId,
      createdAt: now,
      expiresAt: invitationExpiresAt(now),
    })
    .onConflictDoNothing();
}
