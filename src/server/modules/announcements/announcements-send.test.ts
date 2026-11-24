import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { announcement, auditLog, outbox } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  announcementWorld,
  FULL_AUDIENCE_COUNTS,
  fullAudience,
  registrants,
  sampleContent,
} from "./testing";

// #84 AC3 and AC9: sending marks the draft sent (when, by whom, to how
// many) and writes one competition.announcement_sent event and one audit
// row in the same transaction. A sent announcement is never sent again or
// edited.

describe("sendAnnouncement", () => {
  it("includes a registrant with a confirmed place and registration number", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const account = await registrants(h, world.competition).adult({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const member = h.as(await h.signIn(account));
    const manager = await world.manager();
    const id = await world.draft(manager);

    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({
      ok: true,
      counts: { participants: 1 },
    });
    expect(await member.listMyRegistrations()).toEqual([
      expect.objectContaining({
        status: "confirmed",
        registrationNumber: expect.stringMatching(/^CMPAA27-R-/),
      }),
    ]);
  });

  it("marks it sent, with when, by whom and how many, and emits one event with ids only", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    await fullAudience(h, world);
    const manager = await world.manager();
    const id = await world.draft(manager);
    h.clock.advance({ minutes: 30 });
    const sentAt = h.clock.now();

    const result = await h.as(manager).sendAnnouncement({ id, revision: 1 });

    expect(result).toEqual({
      ok: true,
      announcement: expect.objectContaining({
        id,
        status: "sent",
        sentAt,
        recipientCount: 7,
      }),
      counts: FULL_AUDIENCE_COUNTS,
    });
    const [row] = await h.db
      .select({ sentBy: announcement.sentBy })
      .from(announcement)
      .where(eq(announcement.id, id));
    expect(row?.sentBy).toBe(manager.kind === "user" ? manager.userId : null);
    const events = await h.db
      .select({
        eventId: outbox.eventId,
        handler: outbox.handler,
        aggregateId: outbox.aggregateId,
        payload: outbox.payload,
      })
      .from(outbox)
      .where(eq(outbox.eventType, "competition.announcement_sent"));
    expect(new Set(events.map((event) => event.eventId)).size).toBe(1);
    expect(events).toHaveLength(1);
    for (const event of events) {
      expect(event.handler).toBe("announcements.fan_out");
      expect(event.aggregateId).toBe(id);
      expect(event.payload).toEqual({
        announcementId: id,
        competitionId: world.competitionId,
      });
    }
  });

  it("writes one audit row with the counts and no recipient or contact", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    await fullAudience(h, world);
    const manager = await world.manager();
    const id = await world.draft(manager);

    await h.as(manager).sendAnnouncement({ id, revision: 1 });

    const rows = await h.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "announcement.sent"), eq(auditLog.entityId, id))
      );
    expect(rows).toEqual([
      expect.objectContaining({
        entityType: "announcement",
        actorUserId: manager.kind === "user" ? manager.userId : null,
        actorRole: "competition_manager",
        before: { status: "draft" },
        after: { status: "sent", counts: FULL_AUDIENCE_COUNTS },
      }),
    ]);
    const written = JSON.stringify([rows[0]?.before, rows[0]?.after]);
    expect(written).not.toContain("@");
    expect(written).not.toContain("Rao");
  });

  it("refuses a second send, and any edit once sent", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();
    const id = await world.draft(manager);
    await h.as(manager).sendAnnouncement({ id, revision: 1 });

    const again = await h.as(manager).sendAnnouncement({ id, revision: 1 });
    const edited = await h
      .as(manager)
      .updateAnnouncement({ id, content: sampleContent({ subject: "Late" }) });

    expect(again).toEqual({ ok: false, error: "announcement_already_sent" });
    expect(edited).toEqual({ ok: false, error: "announcement_not_editable" });
    const events = await h.db
      .select({ eventId: outbox.eventId })
      .from(outbox)
      .where(eq(outbox.eventType, "competition.announcement_sent"));
    expect(new Set(events.map((event) => event.eventId)).size).toBe(1);
    expect(
      await h.db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.action, "announcement.sent"))
    ).toHaveLength(1);
    const read = await h.as(manager).getAnnouncement({ id });
    expect(read).toMatchObject({
      ok: true,
      announcement: { content: { subject: "Phase 3: the drawing day" } },
    });
  });

  it("keeps the draft and queue unchanged when another manager edits after preview", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const scope = { competitionId: world.competitionId };
    const manager = await world.manager(scope);
    const reviewer = h.as(manager);
    const editor = h.as(await world.manager(scope));
    const target = { ...scope, id: await world.draft(manager) };
    const before = await reviewer.previewAnnouncement(target);
    if (!before.ok) throw new Error("Could not preview the original draft");

    await expect(
      editor.updateAnnouncement({
        ...target,
        content: sampleContent({ subject: "Updated drawing day" }),
      })
    ).resolves.toMatchObject({ ok: true });
    const confirmation = { ...target, revision: before.preview.revision };
    await expect(reviewer.sendAnnouncement(confirmation)).resolves.toEqual({
      ok: false,
      error: "announcement_draft_changed",
    });
    await expect(reviewer.getAnnouncement(target)).resolves.toMatchObject({
      ok: true,
      announcement: { status: "draft" },
    });
    expect(
      await h.db.select().from(outbox).where(eq(outbox.aggregateId, target.id))
    ).toEqual([]);
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "announcement.sent"))
    ).toEqual([]);

    const refreshed = await reviewer.previewAnnouncement(target);
    if (!refreshed.ok) throw new Error("Could not preview the edited draft");
    expect(refreshed.preview.email.subject).toBe(
      "Paws for Thought: Updated drawing day"
    );
    expect(refreshed.preview.revision).toBeGreaterThan(before.preview.revision);
    await expect(
      reviewer.sendAnnouncement({
        ...target,
        revision: refreshed.preview.revision,
      })
    ).resolves.toMatchObject({ ok: true, announcement: { status: "sent" } });
  });

  it("sends to nobody when nobody is confirmed yet, and says so", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();
    const id = await world.draft(manager);

    const result = await h.as(manager).sendAnnouncement({ id, revision: 1 });

    expect(result).toMatchObject({
      ok: true,
      announcement: { status: "sent", recipientCount: 0 },
      counts: {
        recipients: 0,
        participants: 0,
        guardians: 0,
        coordinators: 0,
        unreachable: 0,
      },
    });
  });

  it("says not_found for an announcement that doesn't exist", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();

    expect(
      await h.as(manager).sendAnnouncement({
        id: "01938a00-0000-7000-8000-00000000dead",
        revision: 1,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
