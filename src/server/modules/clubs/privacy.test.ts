import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";
import { staffActor } from "../volunteers/testing";
import { signedInOfficer } from "../privacy/requests/testing";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";
import { subjectScope } from "../privacy/requests/subject-data/scope";

it("exports only the applicant's club data and erases their linked club membership and private decision note", async () => {
  const h = await createHarness();
  await h.settings.set("clubs.enabled", true);
  await h.settings.set("privacy.erasureEnabled", true);
  const { institution } = await seedInstitution(h);
  const person = await h.seed.member();
  const actor = await h.signIn(person);
  const api = h.as(actor);
  await api.joinCommunity({ displayName: "Animal friend" });
  const applied = await api.applyForClub({
    institutionId: institution.id,
    name: "Animal friends",
    kind: "student",
  });
  if (!applied.ok) throw new Error(applied.error);
  const manager = h.as(await staffActor(h, "community_manager"));
  await manager.approveClub({
    clubId: applied.clubId,
    reason: "Private decision sample",
  });
  const exported = await collectSubjectData(h.deps, {
    scope: await subjectScope(h.db, {
      subjectKind: "user",
      subjectId: person.id,
    }),
    subject: { kind: "user", id: person.id },
    reference: "CLUB-EXPORT",
    generatedAt: h.clock.now(),
  });
  expect(exported.document.sections.club).toMatchObject([
    { id: applied.clubId },
  ]);
  expect(exported.document.sections.club_decision).toMatchObject([
    { reason: "Private decision sample" },
  ]);
  expect(exported.document.sections.club_decision![0]).not.toHaveProperty(
    "decided_by_user_id"
  );
  expect(exported.document.sections.club_membership).toHaveLength(1);
  const filed = await api.submitPrivacyRequest({
    type: "erasure",
    subject: { kind: "self" },
  });
  if (!filed.ok) throw new Error(filed.error);
  const officer = h.as((await signedInOfficer(h)).actor);
  expect(
    await officer.startPrivacyRequest({ id: filed.requestId })
  ).toMatchObject({ ok: true });
  const planned = await officer.previewErasure({ id: filed.requestId });
  if (!planned.ok) throw new Error(planned.error);
  expect(
    await officer.executeErasure({
      id: filed.requestId,
      fingerprint: planned.preview.plan.fingerprint,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(
    (await manager.listClubMembers({ clubId: applied.clubId })).members
  ).toEqual([]);
  expect(await manager.getClub({ clubId: applied.clubId })).toMatchObject({
    decisions: [{ reason: null }],
  });
  expect((await manager.listClubsForReview()).clubs).toMatchObject([
    { id: applied.clubId, applicantName: null },
  ]);
});

it("retains former membership and closed decision notes for 730 days, and preserves private timeline history", async () => {
  const h = await createHarness();
  await h.settings.set("clubs.enabled", true);
  await h.settings.set("retention.enforce", true);
  const { institution, admin } = await seedInstitution(h);
  const teacherActor = await h.signIn(admin);
  const teacher = h.as(teacherActor);
  const managerActor = await staffActor(h, "community_manager");
  const manager = h.as(managerActor);
  const applied = await teacher.applyForClub({
    institutionId: institution.id,
    name: "Wildlife club",
  });
  if (!applied.ok) throw new Error(applied.error);
  await manager.approveClub({
    clubId: applied.clubId,
    reason: "Application approved",
  });
  await manager.closeClub({ clubId: applied.clubId, reason: "School closed" });
  const worker = h.as({ kind: "system", process: "worker" });
  h.clock.advance({ days: 729 });
  await worker.runRetentionSweep();
  // Fresh second-factor-backed session after the fake clock moved.
  const refreshedManager = h.as(await staffActor(h, "community_manager"));
  expect(
    (await refreshedManager.listClubMembers({ clubId: applied.clubId })).members
  ).toHaveLength(1);
  expect(
    (await refreshedManager.getClub({ clubId: applied.clubId })).decisions.map(
      (d) => d.reason
    )
  ).toEqual(expect.arrayContaining(["School closed", "Application approved"]));
  h.clock.advance({ days: 1 });
  await worker.runRetentionSweep();
  const latest = h.as(await staffActor(h, "community_manager"));
  expect(
    (await latest.listClubMembers({ clubId: applied.clubId })).members
  ).toEqual([]);
  expect(
    (await latest.getClub({ clubId: applied.clubId })).decisions.map(
      (d) => d.reason
    )
  ).toEqual([null, null]);
  expect((await latest.listClubsForReview()).clubs).toMatchObject([
    { id: applied.clubId, applicantName: null },
  ]);
  const renewed = h.as(await h.signIn(admin));
  expect(
    (await renewed.getTimeline()).entries
      .filter((e) => e.kind.startsWith("club."))
      .map((e) => e.kind)
  ).toEqual(["club.joined", "club.left"]);
});
