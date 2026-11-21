import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { announcementWorld, sampleContent } from "./testing";

describe("announcement drafts", () => {
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
      announcement: {
        id: created.announcement.id,
        competitionId: world.competitionId,
        status: "draft",
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
      content: sampleContent({ subject: "x".repeat(151), duration: "a\u0000b" }),
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
    expect(listed).toEqual({ ok: true, announcements: [] });
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
