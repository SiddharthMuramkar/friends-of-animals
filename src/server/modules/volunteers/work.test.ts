import { and, eq } from "drizzle-orm";
import { guardianLink, userRole } from "../../db/schema";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  adultApplication,
  teenApplication,
  openVolunteering,
  staffActor,
  member,
} from "./testing";
import { istDate } from "./domain/hours";

it("creates, assigns and works a task only through permitted transitions", async () => {
  const h = await createHarness();
  const manager = h.as(await staffActor(h, "community_manager"));
  const person = await adultApplication(h, await openVolunteering(h));
  const volunteer = h.as(person.actor);
  const stranger = h.as(
    (await member(h, { name: "Other", email: "other@example.test" })).actor
  );
  await manager.approveVolunteer({ applicationId: person.applicationId });
  await expect(
    volunteer.createVolunteerTask({
      title: "Prepare flyers",
      description: "Print copies",
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  const created = await manager.createVolunteerTask({
    title: "Prepare flyers",
    description: "Print copies",
  });
  if (!created.ok) throw Error("Task not created");
  const taskId = created.taskId;
  expect(
    await manager.assignVolunteerTask({ taskId, volunteerUserId: person.id })
  ).toMatchObject({ ok: false, error: "invalid_transition" });
  await expect(stranger.publishVolunteerTask({ taskId })).rejects.toMatchObject(
    { code: "forbidden" }
  );
  expect(await manager.publishVolunteerTask({ taskId })).toMatchObject({
    ok: true,
  });
  expect(
    await manager.assignVolunteerTask({ taskId, volunteerUserId: person.id })
  ).toMatchObject({ ok: true });
  await expect(stranger.startVolunteerTask({ taskId })).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await volunteer.startVolunteerTask({ taskId })).toMatchObject({
    ok: true,
  });
  expect(await volunteer.completeVolunteerTask({ taskId })).toMatchObject({
    ok: true,
  });
  expect(await manager.cancelVolunteerTask({ taskId })).toMatchObject({
    ok: false,
    error: "invalid_transition",
  });
  expect(await volunteer.getMyVolunteerRecord()).toMatchObject({
    tasks: [{ id: taskId, status: "done" }],
    approvedMinutes: 0,
  });
  await expect(stranger.getMyVolunteerRecord()).rejects.toMatchObject({
    code: "forbidden",
  });
  const logged = await volunteer.logVolunteerHours({
    taskId,
    minutes: 75,
    workedOn: istDate(h.clock.now()),
    note: "Printed flyers",
  });
  if (!logged.ok) throw Error("Hours not logged");
  await expect(
    volunteer.approveVolunteerHours({ entryId: logged.entryId })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await volunteer.getMyVolunteerRecord()).toMatchObject({
    approvedMinutes: 0,
  });
  expect(
    await manager.approveVolunteerHours({ entryId: logged.entryId })
  ).toMatchObject({ ok: true });
  expect(
    await manager.approveVolunteerHours({ entryId: logged.entryId })
  ).toMatchObject({ ok: false, error: "invalid_transition" });
  expect(await volunteer.getMyVolunteerRecord()).toMatchObject({
    approvedMinutes: 75,
  });
  expect(
    (await volunteer.getTimeline()).milestones.filter(
      (x) => x.kind === "volunteer"
    )
  ).toHaveLength(1);
});

it("issues an adult service certificate for approved minutes only without creating a participant profile", async () => {
  const h = await createHarness();
  const person = await adultApplication(h, await openVolunteering(h));
  const volunteer = h.as(person.actor);
  const manager = h.as(await staffActor(h, "community_manager"));
  await manager.approveVolunteer({ applicationId: person.applicationId });
  const created = await manager.createVolunteerTask({
    title: "Outreach",
    description: "Prepare materials",
  });
  if (!created.ok) throw Error("Task missing");
  const taskId = created.taskId;
  await manager.publishVolunteerTask({ taskId });
  await manager.assignVolunteerTask({ taskId, volunteerUserId: person.id });
  const log = async (minutes: number) => {
    const r = await volunteer.logVolunteerHours({
      taskId,
      minutes,
      workedOn: istDate(h.clock.now()),
    });
    if (!r.ok) throw Error("Log failed");
    return r.entryId;
  };
  await expect(
    h.as(h.visitor()).requestVolunteerCertificate()
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await volunteer.requestVolunteerCertificate()).toEqual({
    ok: false,
    error: "nothing_to_certify",
  });
  const a = await log(95),
    b = await log(60),
    c = await log(20);
  await manager.approveVolunteerHours({ entryId: a });
  await manager.rejectVolunteerHours({ entryId: b, reason: "Wrong duration" });
  const cert = await volunteer.requestVolunteerCertificate();
  if (!cert.ok) throw Error("Certificate missing");
  expect(cert.approvedMinutes).toBe(95);
  expect(await volunteer.requestVolunteerCertificate()).toEqual(cert);
  await h.drain();
  expect(await volunteer.listMyCertificates()).toMatchObject([
    {
      id: cert.certificateId,
      participantProfileId: null,
      approvedMinutes: 95,
      downloadable: true,
    },
  ]);
  expect(
    await volunteer.getCertificateDownloadUrl({
      certificateId: cert.certificateId,
    })
  ).toMatchObject({ ok: true });
  await expect(
    manager.getCertificateDownloadUrl({ certificateId: cert.certificateId })
  ).rejects.toMatchObject({ code: "forbidden" });
  const pdf = h.pdf.rendered.find((job) => job.data.number === cert.number);
  expect(pdf?.data).toMatchObject({
    type: "volunteer_service",
    approvedMinutes: 95,
    competition: null,
  });
  const verifyPath = new URL(pdf!.data.verifyUrl).pathname;
  expect(verifyPath).toBe(`/verify/${cert.number}`);
  const verification = await h
    .as(h.visitor())
    .verifyCertificate({ number: verifyPath.split("/").at(-1)! });
  expect(verification).toMatchObject({
    outcome: "valid",
    type: "volunteer_service",
    approvedMinutes: 95,
    credit: null,
  });
  expect(JSON.stringify(verification)).not.toContain("Priya");
  await manager.approveVolunteerHours({ entryId: c });
  expect(
    (await volunteer.getTimeline()).milestones.filter(
      (x) => x.kind === "volunteer"
    )
  ).toHaveLength(1);
  expect(
    (await volunteer.getTimeline()).entries.filter(
      (x) => x.kind === "volunteer.hours_approved"
    )
  ).toHaveLength(2);
  expect(await volunteer.requestVolunteerCertificate()).toMatchObject({
    ok: true,
    approvedMinutes: 115,
  });
  expect(
    await h.as(h.visitor()).verifyCertificate({ number: cert.number })
  ).toMatchObject({ outcome: "valid", approvedMinutes: 95 });
});

it("protects assigned work, verifies a teen certificate privately with current guardian scope, and preserves terminal revocation", async () => {
  const h = await createHarness();
  const family = await teenApplication(h, await openVolunteering(h));
  const manager = h.as(await staffActor(h, "community_manager"));
  const guardian = h.as(family.guardian.actor),
    teen = h.as(family.teen.actor);
  await guardian.decideAsGuardian({
    applicationId: family.applicationId,
    decision: "approve",
  });
  await manager.approveVolunteer({ applicationId: family.applicationId });
  const other = await h.seed.member();
  await h.seed.grant(other, { role: "volunteer", scope: { type: "global" } });
  const stranger = h.as(await h.signIn(other));
  const task = await manager.createVolunteerTask({
    title: "Volunteer reading",
    description: "Review animal care books",
  });
  if (!task.ok) throw Error("Cannot create task");
  const taskId = task.taskId;
  await manager.publishVolunteerTask({ taskId });
  await expect(
    teen.assignVolunteerTask({ taskId, volunteerUserId: family.teen.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  await manager.assignVolunteerTask({
    taskId,
    volunteerUserId: family.teen.id,
  });
  expect(
    await manager.assignVolunteerTask({
      taskId,
      volunteerUserId: family.teen.id,
    })
  ).toMatchObject({ ok: true });
  expect(
    (await manager.listVolunteerTasks()).tasks[0]?.assignments
  ).toHaveLength(1);
  await expect(stranger.listVolunteerTasks()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    stranger.completeVolunteerTask({ taskId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    stranger.logVolunteerHours({
      taskId,
      minutes: 15,
      workedOn: istDate(h.clock.now()),
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(teen.cancelVolunteerTask({ taskId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    teen.unassignVolunteerTask({ taskId, volunteerUserId: family.teen.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(teen.listVolunteerHours()).rejects.toMatchObject({
    code: "forbidden",
  });
  const entry = await teen.logVolunteerHours({
    taskId,
    minutes: 61,
    workedOn: istDate(h.clock.now()),
    note: "Reading completed",
  });
  if (!entry.ok) throw Error("Cannot log hours");
  await expect(
    teen.rejectVolunteerHours({ entryId: entry.entryId, reason: "No" })
  ).rejects.toMatchObject({ code: "forbidden" });
  await manager.approveVolunteerHours({ entryId: entry.entryId });
  expect(
    await guardian.getChildVolunteerRecord({ childId: family.profileId })
  ).toMatchObject({ approvedMinutes: 61 });
  await expect(
    stranger.getChildVolunteerRecord({ childId: family.profileId })
  ).rejects.toMatchObject({ code: "forbidden" });
  const cert = await teen.requestVolunteerCertificate();
  if (!cert.ok) throw Error("Cannot request certificate");
  await h.drain();
  expect((await guardian.listInbox()).map((item) => item.title)).toEqual(
    expect.arrayContaining([
      "A volunteer task is assigned to your linked child",
      "Your linked child has approved volunteer hours",
    ])
  );
  expect(
    h.email.sent.some(
      (message) =>
        message.subject === "Volunteer hours approved" ||
        message.subject === "Your linked child has approved volunteer hours"
    )
  ).toBe(false);
  expect(await guardian.listMyCertificates()).toMatchObject([
    { id: cert.certificateId, participantProfileId: family.profileId },
  ]);
  expect(
    await guardian.getCertificateDownloadUrl({
      certificateId: cert.certificateId,
    })
  ).toMatchObject({ ok: true });
  expect(
    await teen.requestCertificateShare({ certificateId: cert.certificateId })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(
    await teen.getCertificateShareUrl({ certificateId: cert.certificateId })
  ).toMatchObject({ ok: true });
  expect(
    await h.as(h.visitor()).verifyCertificate({ number: cert.number })
  ).toMatchObject({ outcome: "valid", credit: null, approvedMinutes: 61 });
  await h.db
    .update(guardianLink)
    .set({ revokedAt: h.clock.now() })
    .where(eq(guardianLink.participantProfileId, family.profileId));
  expect(await guardian.listMyCertificates()).toEqual([]);
  await expect(
    guardian.getChildVolunteerRecord({ childId: family.profileId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    guardian.getCertificateDownloadUrl({ certificateId: cert.certificateId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    guardian.getCertificateShareUrl({ certificateId: cert.certificateId })
  ).rejects.toMatchObject({ code: "forbidden" });
  const competitionManager = h.as(await staffActor(h, "competition_manager"));
  await expect(
    competitionManager.retryCertificateRender({
      certificateId: cert.certificateId,
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await manager.retryCertificateRender({ certificateId: cert.certificateId })
  ).toEqual({ ok: false, error: "not_retryable" });
  await expect(
    competitionManager.revokeCertificate({
      certificateId: cert.certificateId,
      reason: "Wrong name",
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(teen.listVolunteerCertificates()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await manager.listVolunteerCertificates()).toMatchObject([
    { id: cert.certificateId, approvedMinutes: 61 },
  ]);
  const replaced = await manager.reissueCertificate({
    certificateId: cert.certificateId,
    reason: "Correct spelling",
    recipientName: "Arjun R.",
  });
  if (!replaced.ok) throw Error("Cannot correct");
  expect(await teen.requestVolunteerCertificate()).toMatchObject({
    certificateId: replaced.certificateId,
    approvedMinutes: 61,
  });
  expect(
    await h.as(h.visitor()).verifyCertificate({ number: cert.number })
  ).toEqual({ outcome: "revoked", number: cert.number });
  expect(
    await manager.revokeCertificate({
      certificateId: replaced.certificateId,
      reason: "Withdraw",
    })
  ).toMatchObject({ ok: true });
  expect(await teen.requestVolunteerCertificate()).toEqual({
    ok: false,
    error: "certificate_revoked",
  });
  expect(
    await h.as(h.visitor()).verifyCertificate({ number: replaced.number })
  ).toEqual({ outcome: "revoked", number: replaced.number });
});

it("rechecks role and staff factor, allows past work within assignment history, and refuses self approval", async () => {
  const h = await createHarness();
  const managerAccount = await h.seed.member({
    name: "Service manager and volunteer",
  });
  await h.seed.grant(managerAccount, {
    role: "community_manager",
    scope: { type: "global" },
  });
  await h.seed.grant(managerAccount, {
    role: "volunteer",
    scope: { type: "global" },
  });
  const manager = h.as(await h.signIn(managerAccount));
  const second = h.as(await staffActor(h, "community_manager"));
  const unverified = h.as(
    await h.signIn(managerAccount, undefined, { secondFactor: false })
  );
  await expect(unverified.listVolunteerTasks()).rejects.toMatchObject({
    code: "second_factor_required",
  });
  const task = await second.createVolunteerTask({
    title: "Read",
    description: "Review materials",
  });
  if (!task.ok) throw Error("Task failed");
  const taskId = task.taskId;
  await second.publishVolunteerTask({ taskId });
  const ordinary = await h.seed.member();
  expect(
    await second.assignVolunteerTask({ taskId, volunteerUserId: ordinary.id })
  ).toEqual({ ok: false, error: "not_volunteer" });
  await second.assignVolunteerTask({
    taskId,
    volunteerUserId: managerAccount.id,
  });
  const firstDate = istDate(h.clock.now());
  h.clock.advance({ days: 2 });
  await second.unassignVolunteerTask({
    taskId,
    volunteerUserId: managerAccount.id,
  });
  expect((await second.listVolunteerTasks()).tasks[0]).toMatchObject({
    status: "open",
    assignments: [],
  });
  h.clock.advance({ days: 1 });
  await second.assignVolunteerTask({
    taskId,
    volunteerUserId: managerAccount.id,
  });
  const entry = await manager.logVolunteerHours({
    taskId,
    workedOn: firstDate,
    minutes: 35,
  });
  if (!entry.ok) throw Error("Earlier assignment lost");
  expect(await second.listVolunteerHours()).toMatchObject([
    { id: entry.entryId, status: "submitted", minutes: 35 },
  ]);
  await expect(
    manager.approveVolunteerHours({ entryId: entry.entryId })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await second.rejectVolunteerHours({ entryId: entry.entryId, reason: " " })
  ).toEqual({ ok: false, error: "reason_required" });
  expect(
    await second.approveVolunteerHours({ entryId: entry.entryId })
  ).toEqual({ ok: true });
  expect(await second.cancelVolunteerTask({ taskId })).toMatchObject({
    ok: true,
  });
  expect(
    await manager.logVolunteerHours({
      taskId,
      workedOn: istDate(h.clock.now()),
      minutes: 5,
    })
  ).toEqual({ ok: false, error: "task_not_accepting_hours" });
  await h.drain();
  expect((await manager.listInbox()).map((x) => x.title)).toContain(
    "Volunteer hours approved"
  );
  await h.db
    .delete(userRole)
    .where(
      and(
        eq(userRole.userId, managerAccount.id),
        eq(userRole.role, "volunteer")
      )
    );
  await expect(manager.requestVolunteerCertificate()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    manager.logVolunteerHours({ taskId, workedOn: firstDate, minutes: 5 })
  ).rejects.toMatchObject({ code: "forbidden" });
});
