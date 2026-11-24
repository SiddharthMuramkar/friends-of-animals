// Shared set-up for #87's Seam 1 tests: a verified school registered for a
// free competition with students its coordinator enrolled and confirmed,
// and a second school with its own coordinator. Test code only; nothing in
// the app imports it.

import type { Actor } from "@/server/actor";
import { enrol, schoolWithStudents } from "@/server/modules/payments/testing";
import { registeredSchool } from "@/server/modules/registration/testing";
import type { SeedCompetitionOptions } from "@/server/seed/competitions";
import type { Harness } from "@/test/harness";

export type ConfirmedSchool = Awaited<ReturnType<typeof confirmedSchool>>;

/**
 * A school (PAWS27, or `code`) whose coordinator enrolled `students`
 * children (each with a guardian whose email is `guardian-<n>@example.test`)
 * and confirmed them for free. With `unconfirmed`, that many more are
 * enrolled after the payment and stay `enrolled`.
 */
export async function confirmedSchool(
  h: Harness,
  {
    students = 2,
    unconfirmed = 0,
    code,
    name,
  }: {
    students?: number;
    unconfirmed?: number;
    code?: string;
    name?: string;
  } = {}
) {
  const school = await schoolWithStudents(h, {
    students,
    feePaise: 0n,
    ...(code ? { code } : {}),
    ...(name ? { name } : {}),
  });
  const paid = await school.pay();
  if (!paid.ok) throw new Error(`Could not confirm: ${JSON.stringify(paid)}`);
  const unconfirmedIds: string[] = [];
  for (let n = 1; n <= unconfirmed; n++) {
    unconfirmedIds.push(await enrol(h, school, students + n));
  }
  // The confirmations' messages go now, so a test sees only its own.
  await h.drain();
  return {
    ...school,
    unconfirmedIds,
    /** The coordinator acting on the `n`th confirmed student (from 1). */
    forStudent: (
      n: number,
      actor: Actor = school.coordinator.actor
    ): { actor: Actor; registrationId: string } => ({
      actor,
      registrationId: school.registrationIds[n - 1]!,
    }),
  };
}

/** A second verified school, registered for `competition`, with its coordinator. */
export async function otherSchool(
  h: Harness,
  competition: SeedCompetitionOptions = { code: "SKIES27" }
) {
  return registeredSchool(h, { name: "Other School", competition });
}
