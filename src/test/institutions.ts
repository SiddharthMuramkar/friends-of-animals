// Coordinator test institutions use the real registration and staff
// decision flow. A grant on a pending or rejected fixture isolates the
// verified-only invitation rule from the policy check.

import type { InstitutionStatus } from "@/server/modules/institutions/domain/status";
import {
  registeredInstitution,
  signedInStaff,
} from "@/server/modules/institutions/testing";

import type { Harness } from "./harness";

/**
 * An invitation's link in a message (#74), its 43-character token in the
 * first group.
 */
export const INVITATION_LINK =
  /\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

export async function seedInstitution(
  h: Harness,
  options: { status?: InstitutionStatus; name?: string } = {}
) {
  const name = options.name ?? "Test School";
  const status = options.status ?? "verified";
  const { person: admin, institutionId: id } = await registeredInstitution(h, {
    name,
  });
  if (status !== "pending_verification") {
    const staff = h.as(await signedInStaff(h));
    const reason = "Checked the school's records";
    const result = await staff.decideInstitution({
      institutionId: id,
      decision: status === "rejected" ? "reject" : "verify",
      reason,
    });
    if (!result.ok) throw new Error(`Could not decide: ${result.error}`);
    if (status === "suspended") {
      const suspended = await staff.decideInstitution({
        institutionId: id,
        decision: "suspend",
        reason,
      });
      if (!suspended.ok) {
        throw new Error(`Could not suspend: ${suspended.error}`);
      }
    }
  }
  if (status === "pending_verification" || status === "rejected") {
    await h.seed.grant(admin, {
      role: "institution_admin",
      scope: { type: "institution", id },
    });
  }
  // The decisions' own messages to the authorised person (#73) go now, so
  // a test sees only what its own step sends.
  await h.drain();
  return { institution: { id, name }, admin };
}

/** Gives `user` the coordinator role at `institutionId`, as seed data. */
export function makeCoordinator(
  h: Harness,
  user: { id: string },
  institutionId: string
) {
  return h.seed.grant(user, {
    role: "institution_coordinator",
    scope: { type: "institution", id: institutionId },
  });
}
