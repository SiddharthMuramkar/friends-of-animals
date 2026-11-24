// Previewing and sending a campaign (#126): a segment only ever holds people
// with current consent; a child's message goes to the guardian; sends go
// through the outbox and are audit-logged with counts; channel choices hold.
import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { consentCompetition } from "@/server/modules/consent/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  campaignAudit,
  communityManager,
  draftCampaign,
  EVERYONE,
  guardianOfChild,
  person,
  SAMPLE_CONTENT,
  sendDraft,
} from "./testing";

function campaignEmailsTo(h: Harness, email: string) {
  return h.email.sent.filter(
    (message) =>
      message.to === email && message.subject === SAMPLE_CONTENT.subject
  );
}

async function campaignInbox(h: Harness, actor: Parameters<Harness["as"]>[0]) {
  const items = await h.as(actor).listInbox();
  return items.filter((item) => item.title === SAMPLE_CONTENT.subject);
}

describe("a segment's members", () => {
  it("are only people whose consent to News and updates is current", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const ravi = await person(h, {
      name: "Ravi Iyer",
      email: "ravi@example.test",
    });
    await h.as(ravi.actor).withdrawConsent({ purpose: "messages" });
    const meera = await person(h, {
      name: "Meera Nair",
      email: "meera@example.test",
      consent: false,
    });

    expect(await h.as(manager).previewSegment({ segment: EVERYONE })).toEqual({
      ok: true,
      counts: expect.objectContaining({ members: 1, recipients: 1 }),
    });
    const draft = await draftCampaign(h, manager);
    await sendDraft(h, manager, draft);
    await h.drain();

    expect(campaignEmailsTo(h, asha.email)).toHaveLength(1);
    expect(campaignEmailsTo(h, ravi.email)).toEqual([]);
    expect(campaignEmailsTo(h, meera.email)).toEqual([]);
    expect(await campaignInbox(h, asha.actor)).toHaveLength(1);
    expect(await campaignInbox(h, ravi.actor)).toEqual([]);
    expect(await campaignInbox(h, meera.actor)).toEqual([]);
  });

  it("are matched by role, competition and city", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const competition = await consentCompetition(h, { fee: 0n });
    const other = await consentCompetition(h, { fee: 0n });
    const puneRegistrant = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
      registerFor: { competition, city: "Pune" },
    });
    const mumbaiRegistrant = await person(h, {
      name: "Ravi Iyer",
      email: "ravi@example.test",
      registerFor: { competition, city: "Mumbai" },
    });
    const elsewhere = await person(h, {
      name: "Meera Nair",
      email: "meera@example.test",
      registerFor: { competition: other, city: "Pune" },
    });
    const volunteer = await person(h, {
      name: "Vikram Volunteer",
      email: "vikram@example.test",
      grants: [{ role: "volunteer", scope: { type: "global" } }],
    });
    const guardian = await guardianOfChild(h, {
      name: "Gita Guardian",
      email: "gita@example.test",
      competition,
      city: "Pune",
    });

    const recipientsOf = async (segment: Partial<typeof EVERYONE>) => {
      const preview = await h
        .as(manager)
        .previewSegment({ segment: { ...EVERYONE, ...segment } });
      return preview.ok ? preview.counts.recipients : -1;
    };
    expect(await recipientsOf({ roles: ["volunteer"] })).toBe(1);
    expect(await recipientsOf({ competitionIds: [competition.id] })).toBe(3);
    expect(
      await recipientsOf({ competitionIds: [competition.id], cities: ["pune"] })
    ).toBe(2);

    const draft = await draftCampaign(h, manager, {
      competitionIds: [competition.id],
      cities: ["Pune"],
    });
    await sendDraft(h, manager, draft);
    await h.drain();
    expect(campaignEmailsTo(h, puneRegistrant.email)).toHaveLength(1);
    expect(campaignEmailsTo(h, guardian.email)).toHaveLength(1);
    expect(campaignEmailsTo(h, mumbaiRegistrant.email)).toEqual([]);
    expect(campaignEmailsTo(h, elsewhere.email)).toEqual([]);
    expect(campaignEmailsTo(h, volunteer.email)).toEqual([]);
  });

  it("reach a child through the guardian who consented, never the child", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const competition = await consentCompetition(h, { fee: 0n });
    const teen = await person(h, {
      name: "Tara Teen",
      email: "tara@example.test",
    });
    const guardian = await guardianOfChild(h, {
      name: "Gita Guardian",
      email: "gita@example.test",
      competition,
      childName: "Tara Teen",
      childAge: 15,
      loginUserId: teen.userId,
      consent: true,
    });
    const unconsented = await guardianOfChild(h, {
      name: "Hari Guardian",
      email: "hari@example.test",
      competition,
      consent: false,
    });

    const draft = await draftCampaign(h, manager, {
      competitionIds: [competition.id],
    });
    const sent = await sendDraft(h, manager, draft);
    await h.drain();

    expect(sent.counts).toEqual({
      matched: 2,
      members: 1,
      recipients: 1,
      noConsent: 1,
      noGuardian: 0,
    });
    expect(campaignEmailsTo(h, guardian.email)).toHaveLength(1);
    expect(campaignEmailsTo(h, teen.email)).toEqual([]);
    expect(await campaignInbox(h, teen.actor)).toEqual([]);
    expect(campaignEmailsTo(h, unconsented.email)).toEqual([]);
  });
});

describe("sendCampaign", () => {
  it("queues the messages through the outbox and audits the counts, never who", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    await person(h, {
      name: "Meera Nair",
      email: "meera@example.test",
      consent: false,
    });
    const draft = await draftCampaign(h, manager);

    const sent = await sendDraft(h, manager, draft);

    expect(sent.campaign).toMatchObject({ status: "sending" });
    expect(campaignEmailsTo(h, asha.email)).toEqual([]);
    const counts = {
      matched: 3,
      members: 1,
      recipients: 1,
      noConsent: 2,
      noGuardian: 0,
    };
    expect(sent.counts).toEqual(counts);

    await h.drain();
    const [email] = campaignEmailsTo(h, asha.email);
    expect(email?.text).toContain("Hello Asha Rao,");
    expect(email?.text).toContain(SAMPLE_CONTENT.body);
    expect(email?.text).toMatch(
      /To stop these messages, open this link: http:\/\/localhost:3000\/withdraw\/[0-9a-f]{64}/
    );
    expect(await h.as(manager).getCampaign({ id: draft.id })).toEqual({
      ok: true,
      campaign: expect.objectContaining({
        status: "sent",
        plannedCounts: counts,
        completedAt: expect.any(Date),
      }),
    });
    expect(await h.as(manager).previewCampaign({ id: draft.id })).toMatchObject(
      { counts, delivered: { queued: 0, sent: 1, skipped: 0 } }
    );
    const audit = await campaignAudit(h, draft.id);
    expect(audit.map((entry) => entry.action)).toEqual([
      "campaign.created",
      "campaign.sent",
      "campaign.completed",
    ]);
    expect(audit[1]).toMatchObject({
      actorRole: "community_manager",
      after: { status: "sending", counts },
    });
    expect(audit[2]).toMatchObject({
      after: { status: "sent", delivered: { queued: 0, sent: 1, skipped: 0 } },
    });
    expect(JSON.stringify(audit)).not.toContain(asha.userId);
    expect(JSON.stringify(audit)).not.toContain(asha.email);
  });

  it("holds a message back when its consent is withdrawn before it goes", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const ravi = await person(h, {
      name: "Ravi Iyer",
      email: "ravi@example.test",
    });
    const draft = await draftCampaign(h, manager);
    await sendDraft(h, manager, draft);

    await h.as(ravi.actor).withdrawConsent({ purpose: "messages" });
    await h.drain();

    expect(campaignEmailsTo(h, asha.email)).toHaveLength(1);
    expect(campaignEmailsTo(h, ravi.email)).toEqual([]);
    expect(await campaignInbox(h, ravi.actor)).toEqual([]);
    expect((await campaignAudit(h, draft.id)).at(-1)).toMatchObject({
      action: "campaign.completed",
      after: { delivered: { queued: 0, sent: 1, skipped: 1 } },
    });
  });

  it("keeps to the recipient's channel choice: no email when they turned it off", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    await h
      .as(asha.actor)
      .updateNotificationPreferences({ email: false, sms: true });
    const draft = await draftCampaign(h, manager);

    await sendDraft(h, manager, draft);
    await h.drain();

    expect(campaignEmailsTo(h, asha.email)).toEqual([]);
    expect(h.sms.sent).toEqual([]);
    const [inApp] = await campaignInbox(h, asha.actor);
    expect(inApp?.body).toContain(SAMPLE_CONTENT.body);
    expect(inApp?.body).toMatch(/\/withdraw\/[0-9a-f]{64}/);
  });

  it("retries an email the provider refused, without a second inbox copy", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const draft = await draftCampaign(h, manager);
    await sendDraft(h, manager, draft);

    h.email.failNext(1, new Error("Provider down"));
    await h.drain();
    expect(campaignEmailsTo(h, asha.email)).toEqual([]);
    expect(await h.as(manager).getCampaign({ id: draft.id })).toMatchObject({
      campaign: { status: "sending" },
    });

    h.clock.advance({ seconds: 30 });
    await h.drain();
    expect(campaignEmailsTo(h, asha.email)).toHaveLength(1);
    expect(await campaignInbox(h, asha.actor)).toHaveLength(1);
    expect(await h.as(manager).getCampaign({ id: draft.id })).toMatchObject({
      campaign: { status: "sent" },
    });
  });

  it("sends a campaign once, refuses an empty segment and an old revision", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    await person(h, { name: "Asha Rao", email: "asha@example.test" });
    const nobody = await draftCampaign(h, manager, { roles: ["judge"] });
    expect(
      await h.as(manager).sendCampaign({ id: nobody.id, revision: 1 })
    ).toEqual({ ok: false, error: "segment_empty" });

    const draft = await draftCampaign(h, manager);
    await h.as(manager).updateCampaign({ ...draft, subject: "Edited" });
    expect(
      await h.as(manager).sendCampaign({ id: draft.id, revision: 1 })
    ).toEqual({ ok: false, error: "campaign_draft_changed" });
    await sendDraft(h, manager, { id: draft.id, revision: 2 });
    expect(
      await h.as(manager).sendCampaign({ id: draft.id, revision: 2 })
    ).toEqual({ ok: false, error: "campaign_already_sent" });
    expect(
      await h.as(manager).updateCampaign({
        ...draft,
        revision: 2,
        subject: "Too late",
      })
    ).toEqual({ ok: false, error: "campaign_not_editable" });
  });
});

describe("previewCampaign", () => {
  it("shows the message as a recipient reads it, with the counts", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    await person(h, { name: "Asha Rao", email: "asha@example.test" });
    const draft = await draftCampaign(h, manager);

    const preview = await h.as(manager).previewCampaign({ id: draft.id });

    expect(preview).toMatchObject({
      ok: true,
      counts: { recipients: 1 },
      delivered: null,
      email: {
        subject: SAMPLE_CONTENT.subject,
        body: expect.stringContaining(SAMPLE_CONTENT.body),
      },
      inApp: { subject: SAMPLE_CONTENT.subject },
    });
    expect(preview.ok && preview.email.body).toContain(
      "To stop these messages, open this link: http://localhost:3000/withdraw/…"
    );
  });
});

describe("who may preview and send", () => {
  it("is a community manager only", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    await person(h, { name: "Asha Rao", email: "asha@example.test" });
    const draft = await draftCampaign(h, manager);
    const member = await h.signIn(await h.seed.member({ name: "Plain" }));
    const contentManager = await h.seed.member({ name: "Content" });
    await h.seed.grant(contentManager, {
      role: "content_manager",
      scope: { type: "global" },
    });
    const refused = [
      h.visitor(),
      member,
      await h.signIn(contentManager),
      await h.signIn(await h.seed.superAdmin({ name: "Super" })),
    ];

    for (const actor of refused) {
      await expect(
        h.as(actor).previewSegment({ segment: EVERYONE })
      ).rejects.toBeInstanceOf(DomainError);
      await expect(
        h.as(actor).previewCampaign({ id: draft.id })
      ).rejects.toBeInstanceOf(DomainError);
      await expect(
        h.as(actor).sendCampaign({ id: draft.id, revision: 1 })
      ).rejects.toBeInstanceOf(DomainError);
    }
    expect(await h.as(manager).getCampaign({ id: draft.id })).toMatchObject({
      campaign: { status: "draft" },
    });
  });
});
