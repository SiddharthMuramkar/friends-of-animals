// Two people of one institution finalising its school round at the same
// moment (#89), from separate connections on real PostgreSQL (`pnpm
// test:pg`). Both lock the round row first, so one finalises; the other
// then finds it finalised and answers round_not_editable, and only one
// shortlist-finalised event and one audit entry exist.

import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  competition,
  competitionFee,
  outbox,
  schoolRound,
} from "@/server/db/schema";
import { validRegistration } from "@/server/modules/institutions/testing";
import {
  AANYA,
  STUDENT_AGE_CUTOFF,
  STUDENT_AGE_GROUPS,
} from "@/server/modules/registration/testing";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { openSchoolRounds } from "./open-school-rounds";

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
    name: `Round race ${code}`,
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

describe("finalising a school round twice at once", () => {
  it("finalises once, emits one event and one audit entry, and tells the other the round can't change", async () => {
    const school = await confirmedSchool();
    // Set-up only: the competition enters school judging and its round
    // opens, as the status job and its handler do.
    await world.db
      .update(competition)
      .set({ status: "school_judging" })
      .where(eq(competition.id, school.competitionId));
    await openSchoolRounds(
      { db: world.db, clock: world.clock },
      { competitionId: school.competitionId }
    );
    const admin = school.people[0]!;
    const coordinator = school.people[1]!;
    const panel = await coordinator.recordPanel({
      ...school.ids,
      members: [{ fullName: "Lata Kulkarni", designation: "Art teacher" }],
    });
    if (!panel.ok) throw new Error(JSON.stringify(panel));
    const certified = await coordinator.certifyConduct(school.ids);
    if (!certified.ok) throw new Error(JSON.stringify(certified));
    const [round] = await world.db
      .select({ id: schoolRound.id })
      .from(schoolRound)
      .where(eq(schoolRound.institutionRegistrationId, school.registrationId));

    const blocker = await world.sql.reserve();
    try {
      await blocker`begin`;
      await blocker`select 1 from school_round where id = ${round!.id} for update`;
      const attempts = [admin, coordinator].map((person) =>
        person.finaliseSchoolRound({ ...school.ids, judgingAttested: true })
      );
      for (const attempt of attempts) attempt.catch(() => {});
      await world.waitForLockWaiters(2);
      await blocker`commit`;

      const results = await Promise.all(attempts);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, error: "round_not_editable" },
      ]);
    } finally {
      blocker.release();
    }
    expect(
      await world.db
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.eventType, "school_round.shortlist_finalised"),
            eq(outbox.aggregateId, round!.id)
          )
        )
    ).toHaveLength(1);
    expect(
      await world.db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "school_round.finalised"),
            eq(auditLog.entityId, round!.id)
          )
        )
    ).toHaveLength(1);
  });
});
