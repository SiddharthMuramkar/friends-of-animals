import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  adultApplication,
  openVolunteering,
  staffActor,
} from "../../volunteers/testing";
import { istDate } from "../../volunteers/domain/hours";

it("uses actual approved service and the stored membership duration (including the exact 90-day boundary)", async () => {
  const h = await createHarness();
  const person = await adultApplication(h, await openVolunteering(h));
  const applicant = h.as(person.actor);
  const manager = h.as(await staffActor(h, "community_manager"));
  const visitor = h.as(h.visitor());
  const refused = { code: "forbidden" };
  await expect(visitor.getMyAmbassador()).rejects.toMatchObject(refused);
  await expect(visitor.applyForAmbassador()).rejects.toMatchObject(refused);
  expect(await applicant.getMyAmbassador()).toMatchObject({
    eligibility: { eligible: false },
  });
  await applicant.joinCommunity({ displayName: "Priya" });
  await manager.approveVolunteer({ applicationId: person.applicationId });
  h.clock.advance({ days: 89 });
  expect(await applicant.applyForAmbassador()).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  const created = await manager.createVolunteerTask({
    title: "Prepare flyers",
    description: "Print copies",
  });
  if (!created.ok) throw Error(created.error);
  const taskId = created.taskId;
  await manager.publishVolunteerTask({ taskId });
  await manager.assignVolunteerTask({ taskId, volunteerUserId: person.id });
  const logged = await applicant.logVolunteerHours({
    taskId,
    minutes: 75,
    workedOn: istDate(h.clock.now()),
  });
  if (!logged.ok) throw Error(logged.error);
  expect(await applicant.applyForAmbassador()).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  await manager.approveVolunteerHours({ entryId: logged.entryId });
  expect(await applicant.getMyAmbassador()).toMatchObject({
    eligibility: {
      eligible: false,
      checks: { membershipDays: false, qualifyingMilestone: true },
    },
  });
  expect(await applicant.applyForAmbassador()).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  h.clock.advance({ days: 1 });
  expect(await applicant.getMyAmbassador()).toMatchObject({
    eligibility: { eligible: true },
  });
  const application = await applicant.applyForAmbassador();
  expect(application).toMatchObject({ ok: true });
  expect(await applicant.applyForAmbassador()).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  expect(await applicant.getMyAmbassador()).toMatchObject({
    application: { status: "submitted" },
  });
});

import { SEED_ACCOUNTS } from "../../../seed/accounts";
import { SEED_GUARDIANS } from "../../../seed/guardians";

it("reviews actual finalist applications with current thresholds, records the milestone once and tells the applicant", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const applicant = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
  const manager = h.as(await staffActor(h, "community_manager"));
  const guest = h.as(await h.signIn(await h.seed.member()));
  const result = await applicant.applyForAmbassador();
  if (!result.ok) throw Error(result.error);
  const applicationId = result.applicationId;
  const approve = { applicationId, decision: "approve" as const };
  const unverified = await h.seed.member();
  await h.seed.grant(unverified, {
    role: "community_manager",
    scope: { type: "global" },
  });
  const noFactor = h.as(
    await h.signIn(unverified, undefined, { secondFactor: false })
  );
  await expect(noFactor.listAmbassadorApplications()).rejects.toMatchObject({
    code: "enrolment_required",
  });
  await expect(noFactor.decideAmbassador(approve)).rejects.toMatchObject({
    code: "enrolment_required",
  });
  await expect(guest.listAmbassadorApplications({})).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(applicant.decideAmbassador(approve)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(
    await manager.listAmbassadorApplications({ status: "submitted" })
  ).toMatchObject({
    ok: true,
    applications: expect.arrayContaining([
      expect.objectContaining({
        id: applicationId,
        status: "submitted",
        eligibility: expect.objectContaining({ eligible: true }),
      }),
    ]),
  });
  expect((await guest.getMyAmbassador()).application).toBeNull();
  await h.settings.set("ambassadors.minMembershipDays", 365);
  expect(await manager.decideAmbassador(approve)).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  await h.settings.set("ambassadors.minMembershipDays", 90);
  await h.settings.set("ambassadors.qualifyingMilestones", "volunteer");
  expect(await manager.decideAmbassador(approve)).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  await h.settings.set(
    "ambassadors.qualifyingMilestones",
    "foa_finalist,volunteer"
  );
  await applicant.leaveCommunity();
  expect(await manager.decideAmbassador(approve)).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  await applicant.joinCommunity({ displayName: "Asha Rao" });
  expect(await manager.decideAmbassador(approve)).toMatchObject({ ok: true });
  expect(await manager.decideAmbassador(approve)).toMatchObject({
    ok: false,
    error: "invalid_transition",
  });
  expect(
    (await applicant.getTimeline()).milestones.filter(
      (row) => row.kind === "ambassador"
    )
  ).toHaveLength(1);
  expect(await applicant.applyForAmbassador()).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  await h.drain();
  expect(await applicant.listInbox()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "Your FOA Ambassador application is approved",
      }),
    ])
  );
  const teen = h.as(await h.signIn(SEED_GUARDIANS.teen));
  await teen.joinCommunity({ displayName: "Teen finalist" });
  await h.settings.set("ambassadors.minMembershipDays", 0);
  const admin = h.as(await h.signIn(await h.seed.superAdmin()));
  expect(
    await admin.changeSetting({ key: "ambassadors.minAgeYears", value: 13 })
  ).toMatchObject({ ok: false, error: "invalid_value" });
  expect(
    await admin.changeSetting({
      key: "ambassadors.qualifyingMilestones",
      value: "community_member",
    })
  ).toMatchObject({ ok: false, error: "invalid_value" });
  expect(
    await admin.changeSetting({ key: "ambassadors.minAgeYears", value: 21 })
  ).toMatchObject({ ok: true });
  await h.settings.set("ambassadors.minAgeYears", 13); // Corrupt legacy setting must still fail closed to adults.
  expect(await teen.applyForAmbassador()).toMatchObject({
    ok: false,
    error: "ineligible",
  });
  const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
  await guardian.joinCommunity({ displayName: "Guardian" });
  expect(await guardian.applyForAmbassador()).toMatchObject({
    ok: false,
    error: "ineligible",
  });
});
