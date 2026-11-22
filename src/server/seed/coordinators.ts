// Coordinators seed data (#74): on the seeded verified institution, a
// coordinator and one invitation still waiting, under fixed ids so links
// and journeys can name them. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import { institution, institutionInvitation } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { invitationExpiresAt } from "../modules/institutions/domain/invitation";
import { storedInvitee } from "../modules/institutions/coordinators/invitee";
import { createLinkToken } from "../crypto/link-token";
import { ensureGrant } from "./access";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_INSTITUTIONS } from "./institutions";
import type { SeedDeps } from "./types";

export const SEED_COORDINATORS = {
  institution: SEED_INSTITUTIONS.verified,
  principal: SEED_INSTITUTIONS.verified.admin,
  /** Member 1 already coordinates there (./access.ts); kept so here too. */
  coordinator: SEED_ACCOUNTS.members[0],
  invitation: {
    id: "01938a00-0000-7000-8000-000000004001",
    email: "invited-teacher@example.test",
  },
} as const;

/** The coordinator and waiting invitation, after the institutions seed. */
export async function seedCoordinators(deps: SeedDeps): Promise<void> {
  const institutionId = SEED_COORDINATORS.institution.id;
  const [verified] = await deps.db
    .select({ principalId: institution.createdBy })
    .from(institution)
    .where(
      and(eq(institution.id, institutionId), eq(institution.status, "verified"))
    );
  if (!verified) return;
  // Member 1, made by the identity seed (with its phone) before this runs.
  const { id, name, email } = SEED_COORDINATORS.coordinator;
  const coordinator = await ensureVerifiedAccount(deps, { id, name, email });
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
      invitedByUserId: verified.principalId,
      createdAt: now,
      expiresAt: invitationExpiresAt(now),
    })
    .onConflictDoNothing();
}
