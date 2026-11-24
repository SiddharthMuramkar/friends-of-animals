import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { outbox } from "@/server/db/schema";
import { makeCoordinator, seedInstitution } from "@/test/institutions";
import { createHarness, type Harness } from "@/test/harness";

import { announcementWorld, sampleContent, signedInWith } from "./testing";

// #84 AC10: every announcement use case lets a global competition manager
// and one scoped to the competition through, and refuses a content
// manager, a coordinator, a participant and a competition manager of
// another competition with `forbidden`.

type World = Awaited<ReturnType<typeof announcementWorld>>;

/** Each use case, run by `actor` against a draft of the world's competition. */
function everyUseCase(world: World, h: Harness, draftId: string) {
  const content = sampleContent({ subject: "Changed" });
  return {
    createAnnouncement: (actor: Actor) =>
      h.as(actor).createAnnouncement({
        competitionId: world.competitionId,
        content,
      }),
    updateAnnouncement: (actor: Actor) =>
      h.as(actor).updateAnnouncement({ id: draftId, content }),
    getAnnouncement: (actor: Actor) =>
      h.as(actor).getAnnouncement({ id: draftId }),
    listAnnouncements: (actor: Actor) =>
      h.as(actor).listAnnouncements({ competitionId: world.competitionId }),
    previewAnnouncement: (actor: Actor) =>
      h.as(actor).previewAnnouncement({ id: draftId }),
    // Last: it freezes the draft for the others.
    sendAnnouncement: (actor: Actor) =>
      h.as(actor).sendAnnouncement({ id: draftId, revision: 2 }),
  };
}

describe("who may manage announcements", () => {
  it("leaves a draft and the outbox untouched until the manager passes their second factor", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const member = await h.seed.member();
    await h.seed.grant(member, {
      role: "competition_manager",
      scope: { type: "competition", id: world.competitionId },
    });
    const manager = await h.signIn(member);
    const id = await world.draft(manager);
    const waiting = await h.signIn(member, undefined, { secondFactor: false });

    await expect(
      h.as(waiting).sendAnnouncement({ id, revision: 1 })
    ).rejects.toMatchObject({
      code: "second_factor_required",
    });

    await expect(h.as(manager).getAnnouncement({ id })).resolves.toMatchObject({
      ok: true,
      announcement: { status: "draft", sentAt: null, recipientCount: null },
    });
    expect(
      await h.db.select().from(outbox).where(eq(outbox.aggregateId, id))
    ).toEqual([]);
  });

  it("cannot read, preview, edit or send a draft under another competition's route", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();
    const id = await world.draft(manager);
    const target = { id, competitionId: world.otherCompetitionId };

    for (const actor of [
      manager,
      await world.manager({ competitionId: world.otherCompetitionId }),
    ]) {
      const as = h.as(actor);
      await expect(as.getAnnouncement(target)).resolves.toEqual({
        ok: false,
        error: "not_found",
      });
      await expect(as.previewAnnouncement(target)).resolves.toEqual({
        ok: false,
        error: "not_found",
      });
      await expect(
        as.updateAnnouncement({
          ...target,
          content: sampleContent({ subject: "Changed" }),
        })
      ).resolves.toEqual({ ok: false, error: "not_found" });
      await expect(
        as.sendAnnouncement({ ...target, revision: 1 })
      ).resolves.toEqual({
        ok: false,
        error: "not_found",
      });
    }

    await expect(
      h.as(manager).getAnnouncement({ id, competitionId: world.competitionId })
    ).resolves.toMatchObject({
      ok: true,
      announcement: {
        status: "draft",
        content: { subject: "Phase 3: the drawing day" },
      },
    });
  });

  it("lets a global competition manager and one scoped to the competition run every use case", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    for (const manager of [
      await world.manager(),
      await world.manager({ competitionId: world.competitionId }),
    ]) {
      const draftId = await world.draft(manager);
      for (const [name, run] of Object.entries(
        everyUseCase(world, h, draftId)
      )) {
        await expect(run(manager), name).resolves.toMatchObject({ ok: true });
      }
    }
  });

  it("refuses a content manager, a coordinator, a participant and another competition's manager", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const draftId = await world.draft(await world.manager());
    const { institution } = await seedInstitution(h, { name: "Hill School" });
    const teacher = await h.seed.member();
    await makeCoordinator(h, teacher, institution.id);
    const refused: [string, Actor][] = [
      [
        "content manager",
        await signedInWith(h, {
          role: "content_manager",
          scope: { type: "global" },
        }),
      ],
      ["coordinator", await h.signIn(teacher)],
      ["participant", await signedInWith(h)],
      [
        "another competition's manager",
        await world.manager({ competitionId: world.otherCompetitionId }),
      ],
      ["visitor", h.visitor()],
    ];

    for (const [who, actor] of refused) {
      for (const [name, run] of Object.entries(
        everyUseCase(world, h, draftId)
      )) {
        await expect(run(actor), `${who}: ${name}`).rejects.toMatchObject({
          code: "forbidden",
        });
      }
    }
    // Nothing they tried changed the draft.
    const read = await h
      .as(await world.manager())
      .getAnnouncement({ id: draftId });
    expect(read).toMatchObject({
      ok: true,
      announcement: {
        status: "draft",
        content: { subject: "Phase 3: the drawing day" },
      },
    });
  });
});
