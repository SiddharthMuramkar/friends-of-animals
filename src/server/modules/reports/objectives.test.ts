import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { confirmedAdult } from "../entries/testing";
import { schoolWithStudents } from "../payments/testing";
import { adultForm, openToIndividuals } from "../participants/testing";
import { signedInWith, managerOf } from "../judging/testing";
import {
  capturedDonation,
  openedOrder,
  openDonations,
  paidByWebhook,
  startedDonation,
} from "../donations/testing";
import { SEED_FEEDBACK } from "../../seed/surveys";
import { SEED_AUCTIONS } from "../../seed/auctions";
import {
  adultApplication,
  openVolunteering,
  staffActor,
} from "../volunteers/testing";
import { registeredInstitution } from "../institutions/testing";
import { parseCsv } from "../registration/domain/csv";

const input = { from: "2027-01-15", to: "2027-01-15" };
const global = { type: "global" } as const;

describe("objective reports", () => {
  it("counts confirmed registrations and unique profiles, not entrants awaiting payment, within inclusive IST dates; global leadership only", async () => {
    const h = await createHarness({ now: "2027-01-14T18:30:00.000Z" });
    const adult = await confirmedAdult(h, { name: "Private adult person" });
    const another = await openToIndividuals(h, { fee: 0n, code: "AGAIN27" });
    const person = h.as(adult.actor);
    const r = await person.registerAsIndividual(adultForm(another));
    if (!r.ok) throw Error(r.error);
    expect(
      await person.payForMyRegistration({ registrationId: r.registrationId })
    ).toMatchObject({ ok: true });
    const school = await schoolWithStudents(h, { feePaise: 0n, students: 2 });
    expect(
      await h.as(school.coordinator.actor).payInstitutionFees(school.ids)
    ).toMatchObject({ ok: true });
    const unpaid = await schoolWithStudents(h, { code: "OPEN27", students: 1 });
    h.clock.set("2027-01-15T18:30:00.000Z");
    await confirmedAdult(h, { code: "LATER27" });
    const leader = h.as(
      await signedInWith(h, { role: "staff_admin", scope: global })
    );
    const report = await leader.getObjectiveReport(input);
    expect(report).toMatchObject({
      ok: true,
      report: {
        participation: {
          registrations: 4,
          participants: 3,
          institutionRegistrations: 2,
          individualRegistrations: 2,
          institutionParticipants: 2,
          individualParticipants: 1,
        },
      },
    });
    const exported = await leader.exportObjectiveReportCsv(input);
    if (!exported.ok) throw Error(exported.error);
    expect(parseCsv(exported.csv)).toMatchObject({
      ok: true,
      records: expect.arrayContaining([
        ["participation", "participants", "3"],
        ["participation", "registrations", "4"],
      ]),
    });
    expect(exported.csv).not.toContain("Private adult person");
    expect(exported.csv).not.toContain(adult.userId);
    for (const actor of [
      adult.actor,
      await signedInWith(h, managerOf(unpaid.competition.id)),
      await signedInWith(h, { role: "content_manager", scope: global }),
    ]) {
      await expect(h.as(actor).getObjectiveReport(input)).rejects.toMatchObject(
        { code: "forbidden" }
      );
      await expect(
        h.as(actor).exportObjectiveReportCsv(input)
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(
      await leader.getObjectiveReport({ from: "2027-02-30", to: "2027-03-01" })
    ).toMatchObject({ ok: false, error: "invalid_input" });
    expect(
      await leader.getObjectiveReport({ from: "2027-01-16", to: "2027-01-15" })
    ).toMatchObject({ ok: false, error: "invalid_input" });
  });
});

it("reads actual engagement, institution approvals, event attendance and approved service, not applications or registrations for events", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const leader = h.as(
    await signedInWith(h, { role: "super_admin", scope: global })
  );
  const manager = h.as(
    await signedInWith(h, { role: "community_manager", scope: global })
  );
  const period = { from: "2026-10-01", to: "2027-01-15" };
  const before = await leader.getObjectiveReport(period);
  expect(before).toMatchObject({
    ok: true,
    report: {
      partnerships: {
        verifiedInstitutions: 1,
        verifiedSchools: 1,
        verifiedColleges: 0,
        verifiedOther: 0,
      },
      engagement: {
        participant: 11,
        school_winner: 1,
        foa_finalist: 8,
        community_member: 3,
        volunteer: 1,
        ambassador: 1,
        clubsApproved: 1,
        clubMembersJoined: 1,
        eventsHeld: 1,
        eventCheckIns: 1,
      },
      volunteers: { volunteers: 1, approvedMinutes: 145 },
      donations: {
        captures: 6,
        capturedMinor: 2_850_050n,
        refundedMinor: 25_050n,
        netMinor: 2_825_000n,
      },
      feedback: { surveysSent: 1, invited: 1, responses: 1 },
      social: [
        {
          channel: "instagram",
          recordedFor: "2026-10-17",
          followers: 120,
          followerChange: null,
          posts: 5,
          reach: 420,
          impressions: 650,
          engagements: 52,
        },
        {
          channel: "instagram",
          recordedFor: "2026-11-16",
          followers: 195,
          followerChange: 75,
          posts: 6,
          reach: 870,
          impressions: 1300,
          engagements: 101,
        },
        {
          channel: "instagram",
          recordedFor: "2026-12-16",
          followers: 240,
          followerChange: 45,
          posts: 8,
          reach: 1100,
          impressions: 1500,
          engagements: 120,
        },
        {
          channel: "youtube",
          recordedFor: "2026-11-16",
          followers: 30,
          followerChange: null,
          posts: 2,
          reach: null,
          impressions: 100,
          engagements: 5,
        },
        {
          channel: "youtube",
          recordedFor: "2026-12-16",
          followers: 39,
          followerChange: 9,
          posts: 3,
          reach: null,
          impressions: 170,
          engagements: 11,
        },
      ],
    },
  });
  await h.seed.preview();
  expect(await leader.getObjectiveReport(period)).toEqual(before);
  const pending = await manager.listAmbassadorApplications({
    status: "submitted",
  });
  if (!pending.ok) throw Error("No applications");
  expect(pending.applications).toHaveLength(1);
  expect(
    await manager.decideAmbassador({
      applicationId: pending.applications[0]!.id,
      decision: "approve",
    })
  ).toMatchObject({ ok: true });
  const report = await leader.getObjectiveReport(period);
  expect(report).toMatchObject({
    ok: true,
    report: { engagement: { ambassador: 2 } },
  });
  const today = await leader.getObjectiveReport(input);
  expect(today).toMatchObject({
    ok: true,
    report: {
      partnerships: { verifiedInstitutions: 0 },
      engagement: {
        community_member: 1,
        ambassador: 1,
        eventsHeld: 0,
        eventCheckIns: 0,
      },
      volunteers: { volunteers: 1, approvedMinutes: 145 },
    },
  });
});

it("counts captured domestic donations once and settles refunds on their own date, excluding fees, pending and refused foreign money", async () => {
  const h = await createHarness();
  await openDonations(h);
  const first = await capturedDonation(h, { amountMinor: 50_125n });
  await capturedDonation(h, {
    email: "second@example.test",
    amountMinor: 10_003n,
  });
  await startedDonation(h, {
    email: "pending@example.test",
    amountMinor: 90_000n,
  });
  const foreign = await startedDonation(h, {
    email: "foreign@example.test",
    amountMinor: 20_000n,
  });
  const order = await openedOrder(h, foreign);
  await paidByWebhook(h, order, { international: true });
  await h.drain();
  const school = await schoolWithStudents(h, { students: 1 });
  const fees = await school.pay();
  if (!fees.ok || fees.kind !== "checkout") throw Error("No fee checkout");
  await paidByWebhook(h, fees.checkout.orderId);
  const admin = h.as(
    await signedInWith(h, { role: "staff_admin", scope: global })
  );
  const today = await admin.getObjectiveReport(input);
  expect(today).toMatchObject({
    ok: true,
    report: {
      donations: {
        captures: 2,
        capturedMinor: 60_128n,
        refundedMinor: 0n,
        netMinor: 60_128n,
      },
    },
  });
  const request = await admin.requestDonationRefund({
    donationId: first.donationId,
    reason: "Returned on donor request",
  });
  if (!request.ok) throw Error(request.error);
  h.clock.advance({ days: 1 });
  const finance = h.as(
    await signedInWith(h, { role: "finance", scope: global })
  );
  expect(
    await finance.approveRefund({ refundId: request.refundId })
  ).toMatchObject({ ok: true });
  await h.drain();
  const leader = h.as(
    await signedInWith(h, { role: "super_admin", scope: global })
  );
  const refundDay = { from: "2027-01-16", to: "2027-01-16" };
  expect(await leader.getObjectiveReport(refundDay)).toMatchObject({
    ok: true,
    report: {
      donations: {
        captures: 0,
        capturedMinor: 0n,
        refundedMinor: 50_125n,
        netMinor: -50_125n,
      },
    },
  });
  expect(await leader.getObjectiveReport(input)).toMatchObject({
    ok: true,
    report: {
      donations: {
        captures: 2,
        capturedMinor: 60_128n,
        refundedMinor: 0n,
        netMinor: 60_128n,
      },
    },
  });
  const csv = await leader.exportObjectiveReportCsv(refundDay);
  if (!csv.ok) throw Error(csv.error);
  expect(csv.csv).toContain("donations,net_inr,-501.25");
  expect(csv.csv).not.toContain(first.paymentId);
  expect(csv.csv).not.toContain("asha@example.test");
});

it("reports retained survey invitations by send date and answers by answer date, without an invalid cross-cohort response rate", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const manager = h.as(
    await signedInWith(h, managerOf(SEED_FEEDBACK.competitionId))
  );
  const leader = h.as(
    await signedInWith(h, { role: "staff_admin", scope: global })
  );
  expect(
    await manager.sendSurvey({ competitionId: SEED_FEEDBACK.competitionId })
  ).toMatchObject({ ok: true, invited: 4 });
  expect(await leader.getObjectiveReport(input)).toMatchObject({
    ok: true,
    report: { feedback: { surveysSent: 1, invited: 4, responses: 0 } },
  });
  h.clock.advance({ days: 1 });
  const artist = h.as(await h.signIn(SEED_AUCTIONS.artist));
  expect(
    await artist.answerSurvey({
      competitionId: SEED_FEEDBACK.competitionId,
      answers: [0, 1],
    })
  ).toMatchObject({ ok: true });
  const nextLeader = h.as(
    await signedInWith(h, { role: "super_admin", scope: global })
  );
  const next = { from: "2027-01-16", to: "2027-01-16" };
  expect(await nextLeader.getObjectiveReport(next)).toMatchObject({
    ok: true,
    report: { feedback: { surveysSent: 0, invited: 0, responses: 1 } },
  });
  const csv = await nextLeader.exportObjectiveReportCsv(next);
  if (!csv.ok) throw Error(csv.error);
  expect(csv.csv).toContain("feedback,responses,1");
  expect(csv.csv).not.toContain(SEED_AUCTIONS.artist.email);
  expect(csv.csv).not.toContain(SEED_FEEDBACK.questions[0]!.text);
});

it("counts approved work on the actual IST workday and each volunteer only once across tasks", async () => {
  const h = await createHarness();
  const person = await adultApplication(h, await openVolunteering(h));
  const volunteer = h.as(person.actor);
  const managerActor = await staffActor(h, "community_manager");
  const manager = h.as(managerActor);
  expect(
    await manager.approveVolunteer({ applicationId: person.applicationId })
  ).toMatchObject({ ok: true });
  const tasks = [];
  for (const name of ["Prepare outreach materials", "Check supplies"]) {
    const created = await manager.createVolunteerTask({
      title: name,
      description: "Help at the awareness activity",
    });
    if (!created.ok) throw Error("Task missing");
    expect(
      await manager.publishVolunteerTask({ taskId: created.taskId })
    ).toMatchObject({ ok: true });
    expect(
      await manager.assignVolunteerTask({
        taskId: created.taskId,
        volunteerUserId: person.id,
      })
    ).toMatchObject({ ok: true });
    tasks.push(created.taskId);
  }
  const logged = [];
  for (const [taskId, minutes] of [
    [tasks[0]!, 65],
    [tasks[1]!, 40],
    [tasks[1]!, 15],
  ] as const) {
    const result = await volunteer.logVolunteerHours({
      taskId,
      workedOn: input.from,
      minutes,
    });
    if (!result.ok) throw Error(result.error);
    logged.push(result.entryId);
  }
  // Approvals happen the following calendar day: earned service still
  // belongs to the day worked, while the ladder milestone occurs today.
  h.clock.advance({ days: 1 });
  // Re-authenticate using this fresh manager instead of relying on expired sessions.
  const nextManager = h.as(await staffActor(h, "community_manager"));
  for (const entryId of logged.slice(0, 2)) {
    expect(await nextManager.approveVolunteerHours({ entryId })).toMatchObject({
      ok: true,
    });
  }
  const leader = h.as(
    await signedInWith(h, { role: "staff_admin", scope: global })
  );
  expect(await leader.getObjectiveReport(input)).toMatchObject({
    ok: true,
    report: {
      volunteers: { volunteers: 1, approvedMinutes: 105 },
      engagement: { volunteer: 0 },
    },
  });
  expect(
    await leader.getObjectiveReport({ from: "2027-01-16", to: "2027-01-16" })
  ).toMatchObject({
    ok: true,
    report: {
      volunteers: { volunteers: 0, approvedMinutes: 0 },
      engagement: { volunteer: 1 },
    },
  });
});

it("counts currently verified partners by original verification day, not registration or reinstatement", async () => {
  const h = await createHarness();
  const school = await registeredInstitution(h, {
    name: "Sample School",
    type: "school",
  });
  const college = await registeredInstitution(h, {
    name: "Sample College",
    type: "college",
  });
  await registeredInstitution(h, { name: "Pending Centre", type: "other" });
  const rejected = await registeredInstitution(h, {
    name: "Rejected Centre",
    type: "other",
  });
  const leader = h.as(
    await signedInWith(h, { role: "staff_admin", scope: global })
  );
  const reason = "Reviewed the sample records";
  for (const institutionId of [school.institutionId, college.institutionId]) {
    expect(
      await leader.decideInstitution({
        institutionId,
        decision: "verify",
        reason,
      })
    ).toMatchObject({ ok: true });
  }
  expect(
    await leader.decideInstitution({
      institutionId: rejected.institutionId,
      decision: "reject",
      reason,
    })
  ).toMatchObject({ ok: true });
  expect(await leader.getObjectiveReport(input)).toMatchObject({
    ok: true,
    report: {
      partnerships: {
        verifiedInstitutions: 2,
        verifiedSchools: 1,
        verifiedColleges: 1,
        verifiedOther: 0,
      },
    },
  });
  h.clock.advance({ days: 1 });
  const next = h.as(
    await signedInWith(h, { role: "super_admin", scope: global })
  );
  expect(
    await next.decideInstitution({
      institutionId: school.institutionId,
      decision: "suspend",
      reason,
    })
  ).toMatchObject({ ok: true });
  expect(await next.getObjectiveReport(input)).toMatchObject({
    ok: true,
    report: {
      partnerships: {
        verifiedInstitutions: 1,
        verifiedSchools: 0,
        verifiedColleges: 1,
        verifiedOther: 0,
      },
    },
  });
  expect(
    await next.decideInstitution({
      institutionId: school.institutionId,
      decision: "verify",
      reason,
    })
  ).toMatchObject({ ok: true });
  expect(await next.getObjectiveReport(input)).toMatchObject({
    ok: true,
    report: { partnerships: { verifiedInstitutions: 2 } },
  });
  expect(
    await next.getObjectiveReport({ from: "2027-01-16", to: "2027-01-16" })
  ).toMatchObject({
    ok: true,
    report: { partnerships: { verifiedInstitutions: 0 } },
  });
});
