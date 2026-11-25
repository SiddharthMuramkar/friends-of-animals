import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

it("permits an affiliated teacher to apply only at a verified institution, while applications are open", async () => {
  const h = await createHarness();
  const { institution, admin } = await seedInstitution(h);
  const pending = await seedInstitution(h, { status: "pending_verification" });
  const api = h.as(await h.signIn(admin));
  const input = { institutionId: institution.id, name: "Animal friends" };
  await expect(h.as(h.visitor()).applyForClub(input)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await api.applyForClub(input)).toEqual({
    ok: false,
    error: "clubs_closed",
  });
  await h.settings.set("clubs.enabled", true);
  expect(
    await h
      .as(await h.signIn(pending.admin))
      .applyForClub({ ...input, institutionId: pending.institution.id })
  ).toEqual({ ok: false, error: "institution_not_verified" });
  const outsider = h.as(await h.signIn(await h.seed.member()));
  expect(await outsider.applyForClub(input)).toEqual({
    ok: false,
    error: "not_at_institution",
  });
  const result = await api.applyForClub(input);
  expect(result).toMatchObject({ ok: true, clubId: expect.any(String) });
  expect(await api.applyForClub(input)).toEqual({
    ok: false,
    error: "application_pending",
  });
});

it("holds one place at a verified institution, including suspended clubs, and only community managers decide", async () => {
  const h = await createHarness();
  await h.settings.set("clubs.enabled", true);
  const { institution, admin } = await seedInstitution(h);
  const teacher = await h.seed.member();
  await h.seed.grant(teacher, {
    role: "institution_coordinator",
    scope: { type: "institution", id: institution.id },
  });
  const one = h.as(await h.signIn(admin));
  const two = h.as(await h.signIn(teacher));
  const manager = h.as(await staffActor(h, "community_manager"));
  const first = await one.applyForClub({
    institutionId: institution.id,
    name: "First club",
  });
  const second = await two.applyForClub({
    institutionId: institution.id,
    name: "Second club",
  });
  if (!first.ok || !second.ok) throw new Error("Fixture applications refused");
  const id = first.clubId;
  await expect(one.approveClub({ clubId: id })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    one.declineClub({ clubId: id, reason: "Not suitable" })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    one.suspendClub({ clubId: id, reason: "Pause" })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    one.closeClub({ clubId: id, reason: "Close" })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    two.withdrawClubApplication({ clubId: id })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await manager.approveClub({ clubId: id })).toMatchObject({
    ok: true,
    status: "approved",
  });
  expect(await manager.approveClub({ clubId: second.clubId })).toEqual({
    ok: false,
    error: "club_limit_reached",
  });
  expect(
    await manager.suspendClub({ clubId: id, reason: "Safety pause" })
  ).toMatchObject({ ok: true, status: "suspended" });
  expect(await manager.approveClub({ clubId: second.clubId })).toEqual({
    ok: false,
    error: "club_limit_reached",
  });
  expect(await manager.approveClub({ clubId: id })).toMatchObject({
    ok: true,
    status: "approved",
  });
  await h.settings.set("clubs.maxPerInstitution", 2);
  expect(await manager.approveClub({ clubId: second.clubId })).toMatchObject({
    ok: true,
    status: "approved",
  });
  expect(
    await manager.closeClub({ clubId: id, reason: "School year ended" })
  ).toMatchObject({ ok: true, status: "closed" });
  expect(await manager.approveClub({ clubId: id })).toEqual({
    ok: false,
    error: "transition_not_allowed",
  });
  const third = await one.applyForClub({
    institutionId: institution.id,
    name: "Third club",
  });
  if (!third.ok) throw new Error(third.error);
  expect(
    await manager.declineClub({ clubId: third.clubId, reason: "Not yet" })
  ).toMatchObject({ ok: true, status: "declined" });
  const fourth = await one.applyForClub({
    institutionId: institution.id,
    name: "Fourth club",
  });
  if (!fourth.ok) throw new Error(fourth.error);
  expect(
    await one.withdrawClubApplication({ clubId: fourth.clubId })
  ).toMatchObject({ ok: true, status: "withdrawn" });
});
import { staffActor } from "../volunteers/testing";

it("allows an actual prospective student with no school-owned login association to apply and join; records private history and scopes member lists", async () => {
  const h = await createHarness();
  await h.settings.set("clubs.enabled", true);
  const { institution, admin } = await seedInstitution(h);
  const other = await seedInstitution(h, { name: "Other school" });
  const teacher = h.as(await h.signIn(admin));
  const stranger = h.as(await h.signIn(other.admin));
  const manager = h.as(await staffActor(h, "community_manager"));
  const family = await linkedTeen(h);
  const student = h.as(family.teen.actor);
  const guardian = h.as(family.guardian.actor);
  expect(await student.joinCommunity({ displayName: "Arjun" })).toMatchObject({
    ok: true,
  });
  const submitted = await student.applyForClub({
    institutionId: institution.id,
    name: "Nature club",
    kind: "student",
  });
  if (!submitted.ok) throw new Error(submitted.error);
  const clubId = submitted.clubId;
  expect(await manager.listClubsForReview()).toMatchObject({
    clubs: [
      {
        id: clubId,
        applicantKind: "student",
        applicantVerified: false,
        status: "applied",
      },
    ],
  });
  await expect(student.listClubsForReview()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await manager.approveClub({ clubId })).toMatchObject({ ok: true });
  expect(await student.joinClub({ clubId, kind: "student" })).toEqual({
    ok: false,
    error: "already_member",
  });
  expect(await teacher.joinClub({ clubId })).toMatchObject({ ok: true });
  await expect(h.as(h.visitor()).joinClub({ clubId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(h.as(h.visitor()).leaveClub({ clubId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(student.listClubMembers({ clubId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(stranger.listClubMembers({ clubId })).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await teacher.listClubMembers({ clubId })).toMatchObject({
    members: expect.arrayContaining([
      expect.objectContaining({
        displayName: "Arjun Rao",
        role: "student",
        affiliationVerified: false,
        joinedAt: expect.any(Date),
        leftAt: null,
      }),
    ]),
  });
  expect((await manager.listClubMembers({ clubId })).members).toHaveLength(2);
  await expect(student.getClubActivity({ clubId })).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(
    (await teacher.getClubActivity({ clubId })).activity.map(
      (entry) => entry.kind
    )
  ).toEqual(expect.arrayContaining(["approved", "joined"]));
  expect((await manager.getClubActivity({ clubId })).activity).toHaveLength(4);
  expect(await student.getClub({ clubId })).toMatchObject({
    club: { id: clubId, memberCount: 2 },
  });
  expect(JSON.stringify(await student.getClub({ clubId }))).not.toContain(
    "Arjun Rao"
  );
  await expect(h.as(h.visitor()).getClub({ clubId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(h.as(h.visitor()).listMyClubs()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(
    await guardian.listMyClubs({ childId: family.profileId })
  ).toMatchObject({ clubs: [{ id: clubId, joined: true }] });
  expect(await guardian.listMyClubs()).toMatchObject({ clubs: [] });
  await expect(
    stranger.listMyClubs({ childId: family.profileId })
  ).rejects.toMatchObject({ code: "forbidden" });
  h.clock.advance({ days: 1 });
  expect(await student.leaveClub({ clubId })).toMatchObject({ ok: true });
  expect(await student.leaveClub({ clubId })).toEqual({
    ok: false,
    error: "not_member",
  });
  expect(await student.joinClub({ clubId, kind: "student" })).toMatchObject({
    ok: true,
  });
  const timeline = await student.getTimeline();
  expect(
    timeline.entries
      .filter((e) => e.kind.startsWith("club."))
      .map((e) => e.kind)
  ).toEqual(["club.joined", "club.left", "club.joined"]);
  expect(await guardian.getTimeline({ childId: family.profileId })).toEqual(
    timeline
  );
  expect((await guardian.getTimeline()).entries).toEqual([]);
});
import { linkedTeen } from "../volunteers/testing";

it("rechecks a school's current status and only sends a decision to the applicant's safe recipients", async () => {
  const h = await createHarness();
  await h.settings.set("clubs.enabled", true);
  const { institution, admin } = await seedInstitution(h);
  const office = h.as(await staffActor(h, "staff_admin"));
  const manager = h.as(await staffActor(h, "community_manager"));
  const teacherActor = await h.signIn(admin);
  const teacher = h.as(teacherActor);
  await expect(
    h.as(h.visitor()).getClubApplicationOptions()
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await teacher.getClubApplicationOptions()).toMatchObject({
    institutions: [{ id: institution.id, verifiedRole: "teacher" }],
  });
  const first = await teacher.applyForClub({
    institutionId: institution.id,
    name: "A school club",
  });
  if (!first.ok) throw new Error(first.error);
  expect(
    await office.decideInstitution({
      institutionId: institution.id,
      decision: "suspend",
      reason: "No longer verified",
    })
  ).toMatchObject({ ok: true });
  expect(await manager.approveClub({ clubId: first.clubId })).toEqual({
    ok: false,
    error: "institution_not_verified",
  });
  expect(
    await office.decideInstitution({
      institutionId: institution.id,
      decision: "verify",
      reason: "Verified again",
    })
  ).toMatchObject({ ok: true });
  expect(
    await manager.declineClub({
      clubId: first.clubId,
      reason: "Private decision",
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(h.email.lastTo(admin.email)?.subject).toBe(
    "FOA club update: declined"
  );
  expect(h.email.lastTo(admin.email)?.text).toContain("Private decision");
  expect(await teacher.listInbox()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "FOA club update: declined",
        body: expect.stringContaining("Private decision"),
      }),
    ])
  );
  const family = await linkedTeen(h);
  const teen = h.as(family.teen.actor);
  await teen.joinCommunity({ displayName: "Arjun" });
  const application = await teen.applyForClub({
    institutionId: institution.id,
    name: "Student club",
    kind: "student",
  });
  if (!application.ok) throw new Error(application.error);
  expect(
    await manager.approveClub({ clubId: application.clubId })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(h.email.lastTo("sunita@example.test")?.subject).toBe(
    "FOA club update: approved"
  );
  expect(
    h.email.sent.filter(
      (m) =>
        m.to === "arjun@example.test" && m.subject.startsWith("FOA club update")
    )
  ).toEqual([]);
  expect(await teen.listInbox()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: "FOA club update: approved" }),
    ])
  );
  expect(
    await office.decideInstitution({
      institutionId: institution.id,
      decision: "suspend",
      reason: "No longer verified",
    })
  ).toMatchObject({ ok: true });
  expect(await teacher.joinClub({ clubId: application.clubId })).toEqual({
    ok: false,
    error: "club_not_open",
  });
  expect(await teen.leaveClub({ clubId: application.clubId })).toMatchObject({
    ok: true,
  });
});

it("requires current verified guardian linkage for a known linked teen to self-attest", async () => {
  const h = await createHarness();
  await h.settings.set("clubs.enabled", true);
  const { institution } = await seedInstitution(h);
  const family = await linkedTeen(h);
  const api = h.as(family.teen.actor);
  await api.joinCommunity({ displayName: "Arjun" });
  expect((await api.getClubApplicationOptions()).institutions).toHaveLength(1);
  // Link revocation is a trusted privacy/safeguarding fact, not a new club API.
  await h.db
    .update(guardianLink)
    .set({ revokedAt: h.clock.now() })
    .where(eq(guardianLink.participantProfileId, family.profileId));
  expect(await api.getClubApplicationOptions()).toMatchObject({
    institutions: [],
    selfAttest: false,
  });
  expect(
    await api.applyForClub({
      institutionId: institution.id,
      name: "Student club",
      kind: "student",
    })
  ).toEqual({ ok: false, error: "not_at_institution" });
});
import { eq } from "drizzle-orm";
import { guardianLink } from "@/server/db/schema";
