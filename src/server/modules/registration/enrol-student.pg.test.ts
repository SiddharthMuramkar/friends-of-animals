// Two coordinators enrolling the same child at once, from separate
// connections on real PostgreSQL (`pnpm test:pg`). Enrolments in one
// institution registration run one at a time under its row lock, so the
// second sees the first and is refused: one profile, one registration.

import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { participantProfile, registration } from "@/server/db/schema";
import { validRegistration } from "@/server/modules/institutions/testing";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { AANYA, STUDENT_AGE_CUTOFF, STUDENT_AGE_GROUPS } from "./testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

/** A competition code no earlier run in the shared database has used. */
function freshCode(): string {
  const letters = Array.from({ length: 5 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  return `${letters}27`;
}

/** A verified institution with two coordinators, registered for an open competition. */
async function registeredSchool() {
  const authorisedPerson = await world.seed.member({
    email: world.uniqueEmail(),
  });
  const registered = await world
    .as(await world.signedIn(authorisedPerson))
    .registerInstitution(validRegistration());
  if (!registered.ok) throw new Error(registered.error);
  const institutionId = registered.institutionId;

  const staff = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(staff, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  await world.seed.authenticator(staff);
  const verified = await world
    .as(await world.signedIn(staff, { secondFactor: true }))
    .decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Checked the school's records",
    });
  if (!verified.ok) throw new Error(verified.error);

  const coordinators = [];
  for (let i = 0; i < 2; i += 1) {
    const teacher = await world.seed.member({ email: world.uniqueEmail() });
    await world.seed.grant(teacher, {
      role: "institution_coordinator",
      scope: { type: "institution", id: institutionId },
    });
    coordinators.push(world.as(await world.signedIn(teacher)));
  }
  const code = freshCode();
  const competition = await world.seed.competition({
    status: "registration_open",
    participation: "institutions",
    // Its own name too: the slug is made from it.
    code,
    name: `Enrolment race ${code}`,
    ageGroups: STUDENT_AGE_GROUPS,
    ageCutoffDate: STUDENT_AGE_CUTOFF,
  });
  const forCompetition =
    await coordinators[0]!.registerInstitutionForCompetition({
      institutionId,
      competitionId: competition.id,
    });
  if (!forCompetition.ok) throw new Error(forCompetition.error);
  return {
    institutionId,
    reference: forCompetition.reference,
    registrationId: forCompetition.registrationId,
    coordinators,
  };
}

describe("enrolling the same child twice at once", () => {
  it("enrols them once and tells the other coordinator they are already enrolled", async () => {
    const school = await registeredSchool();
    // Another request holds the institution registration, so both
    // enrolments queue behind it and race once it lets go.
    const blocker = await world.sql.reserve();
    try {
      await blocker`begin`;
      await blocker`select 1 from institution_registration where id = ${school.registrationId} for no key update`;
      const attempts = school.coordinators.map((coordinator, i) =>
        coordinator.enrolStudent({
          institutionId: school.institutionId,
          reference: school.reference,
          // The same child, typed two ways.
          student: i === 0 ? AANYA : { ...AANYA, fullName: "aanyá rao" },
        })
      );
      for (const attempt of attempts) attempt.catch(() => {});
      await world.waitForLockWaiters(2);
      await blocker`commit`;

      const results = await Promise.all(attempts);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, error: "already_enrolled" },
      ]);
    } finally {
      blocker.release();
    }
    const enrolled = await world.db
      .select({ profileId: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.institutionRegistrationId, school.registrationId));
    expect(enrolled).toHaveLength(1);
    expect(
      await world.db
        .select({ id: participantProfile.id })
        .from(participantProfile)
        .where(
          eq(participantProfile.managingInstitutionId, school.institutionId)
        )
    ).toEqual([{ id: enrolled[0]!.profileId }]);
  });
});
