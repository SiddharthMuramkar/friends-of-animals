// Two people of one institution certifying its conduct at the same moment
// (#87), from separate connections on real PostgreSQL (`pnpm test:pg`).
// The unique institution registration id lets one insert win; the other
// answers already_certified and leaves no second audit entry.

import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  competitionFee,
  conductCertification,
} from "@/server/db/schema";
import { validRegistration } from "@/server/modules/institutions/testing";
import {
  AANYA,
  STUDENT_AGE_CUTOFF,
  STUDENT_AGE_GROUPS,
} from "@/server/modules/registration/testing";
import { createPgWorld, type PgWorld } from "@/test/pg";

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

/**
 * A verified institution with its authorised person and a coordinator,
 * registered for a free competition, with one student confirmed.
 */
async function confirmedSchool() {
  const authorisedPerson = await world.seed.member({
    email: world.uniqueEmail(),
  });
  const admin = world.as(await world.signedIn(authorisedPerson));
  const registered = await admin.registerInstitution(validRegistration());
  if (!registered.ok) throw new Error(registered.error);
  const { institutionId } = registered;

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

  const teacher = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(teacher, {
    role: "institution_coordinator",
    scope: { type: "institution", id: institutionId },
  });
  const coordinator = world.as(await world.signedIn(teacher));
  const code = freshCode();
  const competition = await world.seed.competition({
    status: "registration_open",
    participation: "institutions",
    code,
    name: `Conduct race ${code}`,
    ageGroups: STUDENT_AGE_GROUPS,
    ageCutoffDate: STUDENT_AGE_CUTOFF,
  });
  await world.db.insert(competitionFee).values({
    competitionId: competition.id,
    route: "institution",
    amountMinor: 0n,
    updatedAt: world.clock.now(),
  });
  const forCompetition = await coordinator.registerInstitutionForCompetition({
    institutionId,
    competitionId: competition.id,
  });
  if (!forCompetition.ok) throw new Error(forCompetition.error);
  const ids = { institutionId, reference: forCompetition.reference };
  const enrolled = await coordinator.enrolStudent({ ...ids, student: AANYA });
  if (!enrolled.ok) throw new Error(enrolled.error);
  const paid = await coordinator.payInstitutionFees(ids);
  if (!paid.ok) throw new Error(JSON.stringify(paid));
  return {
    ids,
    competitionId: competition.id,
    registrationId: forCompetition.registrationId,
    people: [admin, coordinator],
  };
}

describe("certifying conduct twice at once", () => {
  it("records one certification and one audit entry, and tells the other it is already certified", async () => {
    const school = await confirmedSchool();
    // Another request holds the competition, so both certifications queue
    // behind it and race once it lets go.
    const blocker = await world.sql.reserve();
    try {
      await blocker`begin`;
      await blocker`select 1 from competition where id = ${school.competitionId} for update`;
      const attempts = school.people.map((person) =>
        person.certifyConduct(school.ids)
      );
      for (const attempt of attempts) attempt.catch(() => {});
      await world.waitForLockWaiters(2);
      await blocker`commit`;

      const results = await Promise.all(attempts);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, error: "already_certified" },
      ]);
    } finally {
      blocker.release();
    }
    expect(
      await world.db
        .select({ id: conductCertification.id })
        .from(conductCertification)
        .where(
          eq(
            conductCertification.institutionRegistrationId,
            school.registrationId
          )
        )
    ).toHaveLength(1);
    expect(
      await world.db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "conduct.certified"),
            eq(auditLog.entityId, school.registrationId)
          )
        )
    ).toHaveLength(1);
  });
});
