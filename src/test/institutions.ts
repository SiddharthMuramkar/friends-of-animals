// PROVISIONAL test support for #74 while #73 (institutions) is unmerged:
// makes an institution row in a given status, with its authorised person
// holding `institution_admin` there, the way #73's verify step leaves it.
// Swap for #73's `h.seed.institution(...)` builder once it lands.

import type { InstitutionStatus } from "@/server/modules/institutions/domain/status";
import { institution } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";

import type { Harness } from "./harness";

let institutions = 0;

export async function seedInstitution(
  h: Harness,
  options: { status?: InstitutionStatus; name?: string } = {}
) {
  institutions += 1;
  const [row] = await h.db
    .insert(institution)
    .values({
      id: uuidv7(h.clock.now()),
      name: options.name ?? `Test School ${institutions}`,
      status: options.status ?? "verified",
      createdAt: h.clock.now(),
    })
    .returning();
  const admin = await h.seed.member({
    name: `Principal ${institutions}`,
    email: `principal-${institutions}@school.test`,
  });
  await h.seed.grant(admin, {
    role: "institution_admin",
    scope: { type: "institution", id: row!.id },
  });
  return { institution: row!, admin };
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
