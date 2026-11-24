import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { consentEvent } from "@/server/db/schema";
import { validRegistration } from "@/server/modules/institutions/testing";
import { openToIndividuals } from "@/server/modules/participants/testing";
import {
  AANYA,
  STUDENT_AGE_CUTOFF,
  STUDENT_AGE_GROUPS,
} from "@/server/modules/registration/testing";
import { seedConsentLinkTemplates } from "@/server/seed/consent-link-templates";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { deliverConsentLink } from "./delivery";
import { deliveredToken } from "./testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world?.close();
});

it("honours a staff suspension already in progress before recording link consent", async () => {
  const admin = await world.seed.member({ email: world.uniqueEmail() });
  const coordinator = world.as(await world.signedIn(admin));
  const school = await coordinator.registerInstitution(validRegistration());
  if (!school.ok) throw new Error("Could not register the fixture school");
  const { institutionId } = school;
  const reviewer = await world.seed.superAdmin({ email: world.uniqueEmail() });
  await world.seed.authenticator(reviewer);
  const staff = world.as(
    await world.signedIn(reviewer, { secondFactor: true })
  );
  const reason = "Synthetic institution review";
  const verified = await staff.decideInstitution({
    institutionId,
    decision: "verify",
    reason,
  });
  if (!verified.ok) throw new Error("Could not verify the fixture school");

  const competition = await openToIndividuals(world, {
    code: "CLINK27",
    name: "Consent link suspension",
    participation: "institutions",
    ageGroups: STUDENT_AGE_GROUPS,
    ageCutoffDate: STUDENT_AGE_CUTOFF,
    publicDisplay: true,
    guardianDocuments: ["public_display"],
    fee: null,
  });
  const registration = await coordinator.registerInstitutionForCompetition({
    institutionId,
    competitionId: competition.id,
  });
  if (!registration.ok)
    throw new Error("Could not register for the fixture competition");
  const enrolled = await coordinator.enrolStudent({
    institutionId,
    reference: registration.reference,
    student: AANYA,
  });
  if (!enrolled.ok) throw new Error("Could not enrol the fixture student");
  const dashboard = await coordinator.listStudentConsents({
    institutionId,
    registrationId: registration.registrationId,
  });
  if (!dashboard.ok || !dashboard.students[0])
    throw new Error("Missing the fixture student");
  const { studentId } = dashboard.students[0];
  const address = world.uniqueEmail();
  await seedConsentLinkTemplates(world.deps);
  const link = await coordinator.sendConsentLink({
    institutionId,
    registrationId: registration.registrationId,
    studentId,
    channel: "email",
    address,
  });
  if (!link.ok) throw new Error("Could not issue the fixture link");
  await deliverConsentLink(world.deps, { linkId: link.linkId });
  const token = deliveredToken(world.deps, address);
  const guardian = world.as({
    kind: "visitor",
    meta: { ip: "203.0.113.83", userAgent: "pg concurrency test" },
  });
  await guardian.sendConsentLinkCode({ token });
  const otp = world.deps.email.codeFor(address);
  if (!otp) throw new Error("Missing the fixture code");
  const session = await guardian.verifyConsentLinkCode({ token, code: otp });
  if (!session.ok) throw new Error("Could not verify the fixture code");

  const { suspending, saving } = await world.sql.begin(async (blocker) => {
    // Keep the authorised decision in progress at its audit write.
    await blocker`lock table audit_log in share mode`;
    const suspending = staff.decideInstitution({
      institutionId,
      decision: "suspend",
      reason,
    });
    await Promise.race([
      world.waitForLockWaiters(1),
      suspending.then(() => {
        throw new Error(
          "The decision finished before the audit lock was released"
        );
      }),
    ]);
    const saving = guardian.answerConsentLink({
      token,
      sessionToken: session.sessionToken,
      answers: { public_display: "give" },
    });
    await Promise.race([world.waitForLockWaiters(2), saving]);
    return { suspending, saving };
  });

  await expect(suspending).resolves.toMatchObject({
    ok: true,
    status: "suspended",
  });
  await expect.soft(saving).resolves.toEqual({ ok: false, error: "not_found" });
  const evidence = await world.db
    .select({ id: consentEvent.id })
    .from(consentEvent)
    .where(eq(consentEvent.consentLinkId, link.linkId));
  expect(evidence).toHaveLength(0);
});
