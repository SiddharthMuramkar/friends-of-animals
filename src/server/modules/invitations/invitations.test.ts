import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { consentCompetition } from "../consent/testing";
import { person } from "../campaigns/testing";
import { publishFixture } from "../surveys/testing";

it("invites a consenting adult only after a real publication, once across retries and backfill", async () => {
  const h = await createHarness();
  await h.settings.set("invitations.enabled", true);
  const comp = await consentCompetition(h, { fee: 0n });
  const adult = await person(h, {
    name: "Adult entrant",
    email: "invite-adult@example.test",
    registerFor: { competition: comp },
  });
  const api = h.as(adult.actor);
  const [reg] = await api.listMyRegistrations();
  expect(
    await api.payForMyRegistration({ registrationId: reg!.registrationId })
  ).toMatchObject({ ok: true });
  expect(await api.myCompetitionInvitations()).toEqual([]);
  await publishFixture(h, comp.id);
  await h.drain();
  expect(await api.myCompetitionInvitations()).toMatchObject([
    { competitionId: comp.id, acceptedActions: [] },
  ]);
  expect(
    h.email.sent.filter(
      (m) => m.to === adult.email && m.text.includes("/dashboard/invitations")
    )
  ).toHaveLength(1);
  await h.drain();
  expect(
    h.email.sent.filter(
      (m) => m.to === adult.email && m.text.includes("/dashboard/invitations")
    )
  ).toHaveLength(1);
});

import { eq } from "drizzle-orm";
import {
  competition,
  competitionInvitation,
  guardianLink,
  participantProfile,
  registration,
  user,
} from "../../db/schema";
import { guardianWithChild, publishNextVersion } from "../consent/testing";
import { publishedRelease } from "../results/read-published";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";
import { EmailNotSentError } from "../../ports/email";

const worker = { kind: "system", process: "worker" } as const;
const emails = (h: Awaited<ReturnType<typeof createHarness>>) =>
  h.email.sent.filter((m) => m.text.includes("/dashboard/invitations"));
async function publication(
  h: Awaited<ReturnType<typeof createHarness>>,
  competitionId: string
) {
  const release = await publishedRelease(h.db, competitionId);
  return {
    competitionId,
    releaseId: release!.releaseId,
    publishedAt: release!.publishedAt.toISOString(),
  };
}

it("guards the worker and pilot use cases, uses true immutable publication, and deduplicates across backfill and live events", async () => {
  const h = await createHarness();
  const comp = await consentCompetition(h, { fee: 0n });
  const adult = await person(h, {
    name: "Pilot adult",
    email: "pilot-adult@example.test",
    registerFor: { competition: comp },
  });
  const api = h.as(adult.actor);
  const [reg] = await api.listMyRegistrations();
  await api.payForMyRegistration({ registrationId: reg!.registrationId });
  const owner = h.as(await h.signIn(await h.seed.superAdmin()));
  const job = h.as(worker);
  const input = {
    competitionId: comp.id,
    releaseId: comp.id,
    publishedAt: h.clock.now().toISOString(),
  };
  await expect(api.queuePublishedInvitations(input)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    api.backfillPilotInvitations({ competitionId: comp.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    job.backfillPilotInvitations({ competitionId: comp.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await owner.backfillPilotInvitations({ competitionId: comp.id })
  ).toMatchObject({ ok: false, error: "disabled" });
  await h.settings.set("invitations.enabled", true);
  await h.db
    .update(competition)
    .set({ status: "results_published" })
    .where(eq(competition.id, comp.id));
  expect(
    await owner.backfillPilotInvitations({ competitionId: comp.id })
  ).toMatchObject({ ok: false, error: "results_not_published" });
  expect(await job.queuePublishedInvitations(input)).toMatchObject({
    ok: false,
    error: "results_not_published",
  });
  // Pilot had published while the feature was paused.
  await h.settings.set("invitations.enabled", false);
  await publishFixture(h, comp.id);
  await h.drain();
  expect(emails(h)).toHaveLength(0);
  await h.settings.set("invitations.enabled", true);
  const real = await publication(h, comp.id);
  expect(
    await job.queuePublishedInvitations({ ...real, releaseId: comp.id })
  ).toMatchObject({ ok: false, error: "results_not_published" });
  expect(
    await owner.backfillPilotInvitations({ competitionId: comp.id })
  ).toEqual({ ok: true, invited: 1 });
  expect(
    await owner.backfillPilotInvitations({ competitionId: comp.id })
  ).toEqual({ ok: true, invited: 0 });
  expect(await job.queuePublishedInvitations(real)).toEqual({
    ok: true,
    invited: 0,
  });
  h.email.failNext(
    1,
    new EmailNotSentError("Fake provider definitely refused")
  );
  await h.drain();
  h.clock.advance({ minutes: 1 });
  await h.drain();
  expect(emails(h).filter((m) => m.to === adult.email)).toHaveLength(1);
  const [invite] = await api.myCompetitionInvitations();
  expect(invite?.actions).toEqual([
    "join_community",
    "volunteer",
    "start_club",
    "join_campaigns",
    "attend_events",
  ]);
  const visitor = h.as(h.visitor());
  await expect(visitor.myCompetitionInvitations()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    visitor.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "join_community",
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  const other = h.as(await h.signIn(await h.seed.member()));
  expect(await other.myCompetitionInvitations()).toEqual([]);
  expect(
    await other.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "volunteer",
    })
  ).toMatchObject({ ok: false, error: "unavailable" });
  for (const [action, destination] of Object.entries({
    join_community: "/dashboard/community",
    volunteer: "/dashboard/volunteer",
    start_club: "/clubs/apply",
    join_campaigns: "/events",
    attend_events: "/events",
  }) as [(typeof invite.actions)[number], string][]) {
    expect(
      await api.acceptCompetitionInvitation({
        invitationId: invite!.id,
        action,
      })
    ).toEqual({ ok: true, destination });
    expect(
      await api.acceptCompetitionInvitation({
        invitationId: invite!.id,
        action,
      })
    ).toEqual({ ok: true, destination });
  }
  expect((await api.myCompetitionInvitations())[0]?.acceptedActions).toEqual(
    invite!.actions
  );
  expect((await api.getMyCommunity()).member).toBeNull();
  expect((await api.getTimeline()).milestones.map((m) => m.kind)).not.toContain(
    "volunteer"
  );
  expect((await api.getTimeline()).milestones.map((m) => m.kind)).not.toContain(
    "ambassador"
  );
  expect(await api.joinCommunity({ displayName: "Pilot adult" })).toMatchObject(
    { ok: true }
  );
  expect((await api.getTimeline()).milestones.map((m) => m.kind)).toContain(
    "community_member"
  );
  await api.withdrawConsent({ purpose: "messages" });
  expect(await api.myCompetitionInvitations()).toEqual([]);
  expect(
    await api.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "attend_events",
    })
  ).toMatchObject({ ok: false, error: "unavailable" });
  const own = await collectSubjectData(h.deps, {
    scope: {
      userIds: [adult.userId],
      profileIds: [
        (
          await h.db
            .select({ id: registration.participantProfileId })
            .from(registration)
            .where(eq(registration.id, reg!.registrationId))
        )[0]!.id,
      ],
    },
    subject: { kind: "user", id: adult.userId },
    reference: "FIXTURE",
    generatedAt: h.clock.now(),
  });
  expect(own.document.sections.competition_invitation).toEqual([
    expect.objectContaining({ accepted_actions: invite!.actions }),
  ]);
  h.clock.advance({ minutes: 11 });
  await expect(
    owner.backfillPilotInvitations({ competitionId: comp.id })
  ).rejects.toMatchObject({ code: "step_up_required" });
});

it("routes linked minors and unknown ages only to verified guardians, skips nonconsent and withdrawal before dispatch, and refuses stale links", async () => {
  const h = await createHarness();
  await h.settings.set("invitations.enabled", true);
  const comp = await consentCompetition(h, { fee: 0n });
  const teen = await person(h, {
    name: "Teen",
    email: "invite-teen@example.test",
  });
  const child = await guardianWithChild(h, comp, {
    age: 15,
    loginUserId: teen.userId,
  });
  const unknown = await guardianWithChild(h, comp, { age: 11 });
  const communication = await publishNextVersion(h, "communications");
  for (const g of [child, unknown]) {
    const parent = h.as(g.actor);
    expect(
      await parent.giveChildConsent({
        childId: g.childId,
        competitionId: comp.id,
        purpose: "participation",
        documentId: comp.guardianDocuments.participation!,
      })
    ).toMatchObject({ ok: true });
    expect(
      await parent.payForMyRegistration({ registrationId: g.registrationId })
    ).toMatchObject({ ok: true });
    expect(
      await parent.giveChildConsent({
        childId: g.childId,
        purpose: "communications",
        documentId: communication.id,
      })
    ).toMatchObject({ ok: true });
  }
  await h.db
    .update(participantProfile)
    .set({
      dobCiphertext: h.deps.cipher.encrypt(
        "participant_profile.dob",
        "unknown"
      ),
    })
    .where(eq(participantProfile.id, unknown.childId));
  const without = await person(h, {
    name: "No consent",
    email: "invite-no@example.test",
    consent: false,
    registerFor: { competition: comp },
  });
  const withdraw = await person(h, {
    name: "Withdraw",
    email: "invite-withdraw@example.test",
    registerFor: { competition: comp },
  });
  for (const p of [without, withdraw]) {
    const api = h.as(p.actor);
    const [reg] = await api.listMyRegistrations();
    expect(
      await api.payForMyRegistration({ registrationId: reg!.registrationId })
    ).toMatchObject({ ok: true });
  }
  await publishFixture(h, comp.id);
  expect(
    await h.as(worker).queuePublishedInvitations(await publication(h, comp.id))
  ).toEqual({ ok: true, invited: 3 });
  await h.as(withdraw.actor).withdrawConsent({ purpose: "messages" });
  await h.drain();
  expect(
    emails(h)
      .map((m) => m.to)
      .sort()
  ).toEqual(
    [
      (
        await h.db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, child.userId))
      )[0]!.email,
      (
        await h.db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, unknown.userId))
      )[0]!.email,
    ].sort()
  );
  expect(await h.as(teen.actor).myCompetitionInvitations()).toEqual([]);
  const parent = h.as(child.actor);
  const [invite] = await parent.myCompetitionInvitations();
  expect(invite).toMatchObject({ relation: "guardian", acceptedActions: [] });
  expect(
    await parent.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "join_community",
    })
  ).toEqual({
    ok: true,
    destination: `/guardian/children/${child.childId}/timeline`,
  });
  expect(
    await parent.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "volunteer",
    })
  ).toEqual({
    ok: true,
    destination: `/guardian/children/${child.childId}/volunteer`,
  });
  const unknownInvites = await h.as(unknown.actor).myCompetitionInvitations();
  expect(unknownInvites[0]?.actions).toEqual([
    "join_community",
    "join_campaigns",
    "attend_events",
  ]);
  expect(
    await h.as(unknown.actor).acceptCompetitionInvitation({
      invitationId: unknownInvites[0]!.id,
      action: "volunteer",
    })
  ).toMatchObject({ ok: false, error: "action_not_offered" });
  await h.db
    .update(guardianLink)
    .set({ revokedAt: h.clock.now() })
    .where(eq(guardianLink.participantProfileId, child.childId));
  expect(await parent.myCompetitionInvitations()).toEqual([]);
  expect(
    await parent.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "attend_events",
    })
  ).toMatchObject({ ok: false, error: "unavailable" });
  expect(await h.db.select().from(competitionInvitation)).toHaveLength(3);
});
