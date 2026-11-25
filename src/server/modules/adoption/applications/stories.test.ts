import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { consentEvent } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import { member } from "../testing";
import {
  adopted,
  adoptionWorld,
  applied,
  coordinator,
  publishAdopterDocument,
  type AdoptionWorld,
} from "./testing";

const STORY = "Bruno sleeps on the sofa now and greets everyone at the door.";

async function adoptedWorld(h: Harness) {
  const world = await adoptionWorld(h);
  const coord = await coordinator(h);
  const applicationId = await applied(h, world);
  await adopted(h, coord, applicationId);
  return { ...world, coord, applicationId };
}

function submit(
  h: Harness,
  world: AdoptionWorld & { applicationId: string },
  body = STORY
) {
  return h.as(world.applicant.actor).submitSuccessStory({
    applicationId: world.applicationId,
    body,
    consentDocumentId: world.documents.story,
  });
}

async function storyConsents(h: Harness, userId: string) {
  return h.db
    .select({ action: consentEvent.action })
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.subjectId, userId),
        eq(consentEvent.purpose, "adoption_success_story")
      )
    )
    .orderBy(consentEvent.id);
}

describe("success stories", () => {
  it("lets the adopter write a story, giving consent, as a draft nobody else sees yet", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);
    expect(
      await h
        .as(world.applicant.actor)
        .myAdoptionApplication({ applicationId: world.applicationId })
    ).toMatchObject({
      canWriteStory: true,
      storyConsentDocument: { id: world.documents.story },
    });

    expect(await submit(h, world)).toEqual({
      ok: true,
      storyId: expect.any(String),
    });

    expect(await storyConsents(h, world.applicant.id)).toEqual([
      { action: "given" },
    ]);
    expect(
      await h
        .as(world.applicant.actor)
        .myAdoptionApplication({ applicationId: world.applicationId })
    ).toMatchObject({
      canWriteStory: false,
      storyConsentGiven: true,
      story: { status: "draft", body: STORY },
    });
    expect(await h.as(h.visitor()).listPublishedSuccessStories()).toEqual([]);
  });

  it("publishes it with consent, showing the animal and organisation but never the adopter", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);
    await submit(h, world);

    expect(
      await h
        .as(world.coord)
        .publishSuccessStory({ applicationId: world.applicationId })
    ).toEqual({ ok: true });

    const stories = await h.as(h.visitor()).listPublishedSuccessStories();
    expect(stories).toEqual([
      {
        id: expect.any(String),
        body: STORY,
        publishedAt: h.clock.now(),
        animal: { name: "Bruno", species: "dog" },
        organisation: { name: "Paws Pune", slug: expect.any(String) },
      },
    ]);
    const text = JSON.stringify(stories);
    expect(text).not.toContain("Meera");
    expect(text).not.toContain("meera@example.test");
    expect(text).not.toContain("98765");
  });

  it("refuses to publish once the adopter has withdrawn consent, and takes a published story down on withdrawal", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);
    await submit(h, world);
    await h
      .as(world.coord)
      .publishSuccessStory({ applicationId: world.applicationId });

    expect(
      await h
        .as(world.applicant.actor)
        .withdrawSuccessStoryConsent({ applicationId: world.applicationId })
    ).toEqual({ ok: true, withdrawnStories: 1 });

    expect(await h.as(h.visitor()).listPublishedSuccessStories()).toEqual([]);
    expect(await storyConsents(h, world.applicant.id)).toEqual([
      { action: "given" },
      { action: "withdrawn" },
    ]);
    expect(
      await h
        .as(world.coord)
        .publishSuccessStory({ applicationId: world.applicationId })
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("refuses to publish a draft whose consent no longer stands", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);
    await submit(h, world);
    // Withdrawing ends the draft too, so publishing finds nothing to publish.
    await h
      .as(world.applicant.actor)
      .withdrawSuccessStoryConsent({ applicationId: world.applicationId });

    expect(
      await h
        .as(world.coord)
        .getAdoptionApplication({ applicationId: world.applicationId })
    ).toMatchObject({
      story: { status: "withdrawn" },
      storyConsentGiven: false,
    });
    expect(
      await h
        .as(world.coord)
        .publishSuccessStory({ applicationId: world.applicationId })
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("allows a story only for an adopted application", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const open = await applied(h, world);

    expect(await submit(h, { ...world, applicationId: open })).toEqual({
      ok: false,
      error: "not_adopted",
    });
  });

  it("needs the current story consent document", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);
    await publishAdopterDocument(h, "adoption_success_story");

    expect(await submit(h, world)).toEqual({
      ok: false,
      error: "consent_outdated",
    });
  });

  it("refuses a second story and text out of bounds", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);

    expect(await submit(h, world, "Too short")).toMatchObject({
      ok: false,
      error: "invalid_input",
      fields: ["body"],
    });
    await submit(h, world);
    expect(await submit(h, world)).toEqual({
      ok: false,
      error: "story_exists",
    });
  });

  it("refuses another member, the representative and the coordinator writing or withdrawing for the adopter", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);
    await submit(h, world);

    for (const actor of [await member(h), world.rep.actor, world.coord]) {
      await expect(
        h.as(actor).submitSuccessStory({
          applicationId: world.applicationId,
          body: STORY,
          consentDocumentId: world.documents.story,
        })
      ).rejects.toThrow(DomainError);
      await expect(
        h
          .as(actor)
          .withdrawSuccessStoryConsent({ applicationId: world.applicationId })
      ).rejects.toThrow(DomainError);
    }
  });

  it("refuses the adopter, the representative and a visitor publishing", async () => {
    const h = await createHarness();
    const world = await adoptedWorld(h);
    await submit(h, world);

    for (const actor of [world.applicant.actor, world.rep.actor, h.visitor()]) {
      await expect(
        h.as(actor).publishSuccessStory({ applicationId: world.applicationId })
      ).rejects.toThrow(DomainError);
    }
  });
});
