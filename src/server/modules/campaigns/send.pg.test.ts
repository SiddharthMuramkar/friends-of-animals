// Races on a real Postgres (#126): two sends of one draft queue its
// messages once, and of two runs settling a campaign's last messages at
// once only one marks it sent and audits the counts.
import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import {
  auditLog,
  campaignRecipient,
  outbox,
  userRole,
} from "@/server/db/schema";
import { deliverCampaignMessage } from "@/server/modules/campaigns/deliver";
import { insertConsentDocumentVersion } from "@/server/modules/consent/insert-version";
import { parseConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import { createPgWorld, type PgWorld } from "@/test/pg";

async function messagesDocument(world: PgWorld): Promise<string> {
  const parsed = parseConsentDocumentBody({
    short: [["Draft messages consent."]],
    sections: [
      {
        id: "what-you-agree-to",
        title: "What you agree to",
        blocks: [{ p: ["Draft messages text. Not FOA's words."] }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  const { id } = await world.db.transaction((tx) =>
    insertConsentDocumentVersion(
      tx,
      { now: world.clock.now(), publishedByUserId: null },
      {
        purpose: "messages",
        title: null,
        body: parsed.body,
        legalRevisionId: null,
      }
    )
  );
  return id;
}

/**
 * A community manager and two people who consented to News and updates,
 * each an organisation representative. The database is shared, so each
 * test takes their grants away again when it ends.
 */
async function representatives() {
  const world = createPgWorld();
  const admin = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(admin, {
    role: "community_manager",
    scope: { type: "global" },
  });
  await world.seed.authenticator(admin);
  const manager = world.as(await world.signedIn(admin, { secondFactor: true }));
  const documentId = await messagesDocument(world);
  const organisation = randomUUID();
  const recipients: string[] = [];
  for (let n = 0; n < 2; n += 1) {
    const member = await world.seed.member({ email: world.uniqueEmail() });
    await world.seed.grant(member, {
      role: "organisation_representative",
      scope: { type: "organisation", id: organisation },
    });
    const actor = world.as(await world.signedIn(member));
    await actor.giveConsent({ purpose: "messages", documentId });
    recipients.push(member.id);
  }
  return { world, manager, recipients };
}

it("queues a draft's messages once when it is sent twice at once", async () => {
  const { world, manager, recipients } = await representatives();
  try {
    const created = await manager.createCampaign({
      subject: "Race",
      body: "Once only.",
      segment: {
        roles: ["organisation_representative"],
        competitionIds: [],
        cities: [],
      },
    });
    if (!created.ok) throw new Error("Creating failed");
    const { id } = created.campaign;

    const results = await Promise.all([
      manager.sendCampaign({ id, revision: 1 }),
      manager.sendCampaign({ id, revision: 1 }),
    ]);

    const sent = results.filter((result) => result.ok);
    expect(sent).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: "campaign_already_sent" },
    ]);
    const rows = await world.db
      .select({ id: campaignRecipient.id, userId: campaignRecipient.userId })
      .from(campaignRecipient)
      .where(eq(campaignRecipient.campaignId, id));
    expect(rows.map((row) => row.userId)).toEqual(
      expect.arrayContaining(recipients)
    );
    expect(rows).toHaveLength(sent[0]!.ok ? sent[0]!.counts.recipients : -1);
    const events = await world.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        inArray(
          outbox.aggregateId,
          rows.map((row) => row.id)
        )
      );
    expect(events).toHaveLength(rows.length);
    const audits = await world.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.entityId, id), eq(auditLog.action, "campaign.sent"))
      );
    expect(audits).toHaveLength(1);
  } finally {
    await world.db.delete(userRole).where(inArray(userRole.userId, recipients));
    await world.close();
  }
});

it("completes a campaign once when its last messages settle at once", async () => {
  const { world, manager, recipients } = await representatives();
  try {
    const created = await manager.createCampaign({
      subject: "Settle",
      body: "Together.",
      segment: {
        roles: ["organisation_representative"],
        competitionIds: [],
        cities: [],
      },
    });
    if (!created.ok) throw new Error("Creating failed");
    const { id } = created.campaign;
    const sent = await manager.sendCampaign({ id, revision: 1 });
    if (!sent.ok) throw new Error("Sending failed");
    const jobs = await world.db
      .select()
      .from(outbox)
      .innerJoin(
        campaignRecipient,
        eq(campaignRecipient.id, outbox.aggregateId)
      )
      .where(eq(campaignRecipient.campaignId, id));

    await Promise.all(
      jobs.map(({ outbox: job }) =>
        deliverCampaignMessage(world.deps, {
          id: job.id,
          eventId: job.eventId,
          eventType: "campaign.message_due",
          occurredAt: job.occurredAt,
          attempt: 1,
          payload: job.payload as { campaignId: string; recipientId: string },
        })
      )
    );

    const completed = await world.db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, id),
          eq(auditLog.action, "campaign.completed")
        )
      );
    expect(completed).toEqual([
      {
        after: {
          status: "sent",
          delivered: { queued: 0, sent: jobs.length, skipped: 0 },
        },
      },
    ]);
  } finally {
    await world.db.delete(userRole).where(inArray(userRole.userId, recipients));
    await world.close();
  }
});
