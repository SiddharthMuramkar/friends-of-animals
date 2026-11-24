import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { announcement, auditLog } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { announcementWorld, sampleContent } from "./testing";

describe("announcement drafts", () => {
  it("audits draft creation and editing under the authorizing manager role", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager({ competitionId: world.competitionId });
    if (manager.kind !== "user")
      throw new Error("Expected a signed-in manager");
    const id = await world.draft(manager);
    await expect(
      h.as(manager).updateAnnouncement({
        id,
        content: sampleContent({
          subject: "Changed subject",
          helpContacts: "rita@example.test",
        }),
      })
    ).resolves.toMatchObject({ ok: true });

    const entries = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, id))
      .orderBy(auditLog.id);
    const actor = {
      entityType: "announcement",
      actorRole: "competition_manager",
      actorUserId: manager.userId,
    };
    expect(entries).toEqual([
      expect.objectContaining({
        ...actor,
        action: "announcement.created",
        before: null,
        after: { status: "draft" },
      }),
      expect.objectContaining({
        ...actor,
        action: "announcement.updated",
        before: { status: "draft" },
        after: { status: "draft" },
      }),
    ]);
  });

  it("keeps personal help contacts encrypted and renders their updated value in an authorized preview", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();
    const id = await world.draft(manager, {
      helpContacts: "Write to Rita at rita@example.test",
    });
    const storedDraft = () =>
      h.db.select().from(announcement).where(eq(announcement.id, id));
    expect(JSON.stringify(await storedDraft())).not.toContain(
      "rita@example.test"
    );

    const helpContacts = "Ask Radha at radha@example.test";
    const asManager = h.as(manager);
    await expect(
      asManager.updateAnnouncement({
        id,
        content: sampleContent({ helpContacts }),
      })
    ).resolves.toMatchObject({
      ok: true,
      announcement: { content: { helpContacts } },
    });
    expect(JSON.stringify(await storedDraft())).not.toContain(
      "radha@example.test"
    );
    await expect(asManager.previewAnnouncement({ id })).resolves.toMatchObject({
      ok: true,
      preview: {
        email: { text: expect.stringContaining(helpContacts) },
        inApp: { body: expect.stringContaining(helpContacts) },
      },
    });
  });

  it("a competition manager creates a draft and reads it back", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();

    const created = await world.as(manager).createAnnouncement({
      competitionId: world.competitionId,
      content: sampleContent(),
    });
    if (!created.ok) throw new Error(`Not created: ${created.error}`);
    const read = await world
      .as(manager)
      .getAnnouncement({ id: created.announcement.id });

    expect(read).toEqual({
      ok: true,
      competition: {
        id: world.competitionId,
        code: world.competition.code,
        name: "Paws for Thought",
      },
      announcement: {
        id: created.announcement.id,
        competitionId: world.competitionId,
        status: "draft",
        revision: 1,
        content: {
          subject: "Phase 3: the drawing day",
          eventAt: new Date("2027-02-06T04:30:00.000Z"),
          confirmedTheme: "Street dogs of our city",
          permittedMaterials: "Pencils, crayons and watercolours on A3 paper",
          duration: "Two hours",
          submissionSteps:
            "Photograph your drawing in daylight.\nUpload it from your dashboard.",
          physicalArtworkRequirements:
            "Post the original drawing to the FOA office.",
          deadlines: "Uploads close on 13 February 2027 at 11:59 pm IST.",
          helpContacts: "Write to competitions@foa.example",
          message: null,
        },
        createdAt: new Date("2027-01-15T04:30:00.000Z"),
        updatedAt: new Date("2027-01-15T04:30:00.000Z"),
        sentAt: null,
        recipientCount: null,
      },
    });
  });

  it("keeps an edit's content and when it was made", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();
    const id = await world.draft(manager);

    h.clock.advance({ hours: 2 });
    const updated = await world.as(manager).updateAnnouncement({
      id,
      content: sampleContent({
        subject: "  Phase 3: the drawing day (new time)  ",
        duration: "",
        message: "Bring a water bottle.\r\nWear old clothes.",
      }),
    });
    const read = await world.as(manager).getAnnouncement({ id });

    expect(updated).toMatchObject({ ok: true });
    expect(read).toMatchObject({
      ok: true,
      announcement: {
        content: {
          subject: "Phase 3: the drawing day (new time)",
          duration: null,
          message: "Bring a water bottle.\nWear old clothes.",
        },
        createdAt: new Date("2027-01-15T04:30:00.000Z"),
        updatedAt: new Date("2027-01-15T06:30:00.000Z"),
      },
    });
  });

  it("lists only this competition's announcements, newest first", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();
    await world.draft(manager, { subject: "First" });
    h.clock.advance({ minutes: 5 });
    await world.draft(manager, { subject: "Second" });
    await world.as(manager).createAnnouncement({
      competitionId: world.otherCompetitionId,
      content: sampleContent({ subject: "Another competition's" }),
    });

    const listed = await world
      .as(manager)
      .listAnnouncements({ competitionId: world.competitionId });

    expect(listed).toEqual({
      ok: true,
      competition: expect.objectContaining({ id: world.competitionId }),
      announcements: [
        expect.objectContaining({ subject: "Second", status: "draft" }),
        expect.objectContaining({ subject: "First", status: "draft" }),
      ],
    });
  });

  it("refuses content that fails its rules and names the fields", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();

    const tooLong = await world.as(manager).createAnnouncement({
      competitionId: world.competitionId,
      content: sampleContent({
        subject: "x".repeat(151),
        duration: "a\u0000b",
      }),
    });
    const empty = await world.as(manager).createAnnouncement({
      competitionId: world.competitionId,
      content: {
        subject: "Only a subject",
        eventAt: null,
        confirmedTheme: null,
        permittedMaterials: null,
        duration: null,
        submissionSteps: null,
        physicalArtworkRequirements: null,
        deadlines: null,
        helpContacts: null,
        message: null,
      },
    });
    const listed = await world
      .as(manager)
      .listAnnouncements({ competitionId: world.competitionId });

    expect(tooLong).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["subject", "duration"],
    });
    expect(empty).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["sections"],
    });
    expect(listed).toEqual({
      ok: true,
      competition: expect.objectContaining({ id: world.competitionId }),
      announcements: [],
    });
  });

  it("says not_found for an announcement that doesn't exist", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();

    const missing = "01938a00-0000-7000-8000-00000000dead";
    const results = [
      await world.as(manager).getAnnouncement({ id: missing }),
      await world.as(manager).getAnnouncement({ id: "not-a-uuid" }),
      await world
        .as(manager)
        .updateAnnouncement({ id: missing, content: sampleContent() }),
    ];

    expect(results).toEqual([
      { ok: false, error: "not_found" },
      { ok: false, error: "not_found" },
      { ok: false, error: "not_found" },
    ]);
  });
});
