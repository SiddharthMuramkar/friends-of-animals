// Shared set-up for the registration module's Seam 1 tests. Test code
// only; nothing in the app imports it.

import type { Actor } from "@/server/actor";
import type { SeedCompetitionOptions } from "@/server/seed/competitions";
import type { Harness } from "@/test/harness";
import { makeCoordinator } from "@/test/institutions";

/** A signed-in coordinator of `institutionId`. */
export async function signInCoordinator(
  h: Harness,
  institutionId: string,
  details: { name?: string; email?: string } = {},
  meta?: { ip?: string; userAgent?: string }
): Promise<{ actor: Actor; userId: string }> {
  const teacher = await h.seed.member(details);
  await makeCoordinator(h, teacher, institutionId);
  return { actor: await h.signIn(teacher, meta), userId: teacher.id };
}

/**
 * A competition taking institutions with registration open now: its key
 * dates are the seed's, 20 days behind and 55 days ahead of the clock.
 */
export function openCompetition(
  h: Harness,
  options: SeedCompetitionOptions = {}
) {
  return h.seed.competition({
    status: "registration_open",
    participation: "institutions",
    ...options,
  });
}
