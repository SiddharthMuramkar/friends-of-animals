// Campaign drafts (#126): a community manager writes a campaign for a
// segment, edits it until it is sent, and reads it back. Nobody else may.
import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import {
  campaignAudit,
  communityManager,
  draftCampaign,
  EVERYONE,
  SAMPLE_CONTENT,
} from "./testing";

const COMPETITION = "01938a00-0000-7000-8000-00000000a001";

async function refusedActors(h: Harness) {
  const member = await h.signIn(await h.seed.member({ name: "Plain Member" }));
  const competitionManager = await h.seed.member({ name: "Comp Manager" });
  await h.seed.grant(competitionManager, {
    role: "competition_manager",
    scope: { type: "global" },
  });
  const superAdmin = await h.seed.superAdmin({ name: "Super Admin" });
  return {
    visitor: h.visitor(),
    member,
    competitionManager: await h.signIn(competitionManager),
    superAdmin: await h.signIn(superAdmin),
  };
}

describe("createCampaign", () => {
  it("lets a community manager save a draft for a segment, audited", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);

    const created = await h.as(manager).createCampaign({
      ...SAMPLE_CONTENT,
      segment: {
        roles: ["volunteer", "guardian"],
        competitionIds: [COMPETITION],
        cities: [" pune "],
      },
    });

    expect(created).toEqual({
      ok: true,
      campaign: expect.objectContaining({
        status: "draft",
        revision: 1,
        subject: SAMPLE_CONTENT.subject,
        body: SAMPLE_CONTENT.body,
        segment: {
          roles: ["guardian", "volunteer"],
          competitionIds: [COMPETITION],
          cities: ["pune"],
        },
        sentAt: null,
        plannedCounts: null,
      }),
    });
    const id = created.ok ? created.campaign.id : "";
    expect(await campaignAudit(h, id)).toEqual([
      expect.objectContaining({
        action: "campaign.created",
        actorRole: "community_manager",
        before: null,
      }),
    ]);
  });

  it("says which fields are wrong", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);

    expect(
      await h.as(manager).createCampaign({
        subject: " ",
        body: "Hello",
        segment: { ...EVERYONE, roles: ["super_admin"] as never },
      })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["subject", "segment"],
    });
  });

  it("refuses anyone but a community manager", async () => {
    const h = await createHarness();
    const actors = await refusedActors(h);

    for (const actor of Object.values(actors)) {
      await expect(
        h.as(actor).createCampaign({ ...SAMPLE_CONTENT, segment: EVERYONE })
      ).rejects.toBeInstanceOf(DomainError);
    }
  });
});

describe("updateCampaign, getCampaign and listCampaigns", () => {
  it("replaces a draft's wording and segment, and raises its revision", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const draft = await draftCampaign(h, manager);
    h.clock.advance({ minutes: 5 });

    const updated = await h.as(manager).updateCampaign({
      id: draft.id,
      revision: draft.revision,
      subject: "Adoption camp moved to Saturday",
      body: draft.body,
      segment: { ...EVERYONE, cities: ["Mumbai"] },
    });

    expect(updated).toEqual({
      ok: true,
      campaign: expect.objectContaining({
        revision: 2,
        subject: "Adoption camp moved to Saturday",
        segment: { ...EVERYONE, cities: ["Mumbai"] },
      }),
    });
    expect(await h.as(manager).getCampaign({ id: draft.id })).toEqual({
      ok: true,
      campaign: expect.objectContaining({ revision: 2 }),
    });
    expect((await campaignAudit(h, draft.id)).map((a) => a.action)).toEqual([
      "campaign.created",
      "campaign.updated",
    ]);
  });

  it("refuses an edit made from an older revision", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const draft = await draftCampaign(h, manager);
    await h
      .as(manager)
      .updateCampaign({ ...draft, revision: 1, subject: "First edit" });

    expect(
      await h
        .as(manager)
        .updateCampaign({ ...draft, revision: 1, subject: "Second edit" })
    ).toEqual({ ok: false, error: "campaign_draft_changed" });
  });

  it("lists campaigns newest first and answers not_found for an unknown id", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const first = await draftCampaign(
      h,
      manager,
      {},
      {
        subject: "First",
        body: "One",
      }
    );
    h.clock.advance({ minutes: 1 });
    const second = await draftCampaign(
      h,
      manager,
      {},
      {
        subject: "Second",
        body: "Two",
      }
    );

    expect(await h.as(manager).listCampaigns()).toEqual({
      ok: true,
      campaigns: [
        expect.objectContaining({ id: second.id, subject: "Second" }),
        expect.objectContaining({ id: first.id, subject: "First" }),
      ],
    });
    expect(
      await h
        .as(manager)
        .getCampaign({ id: "01938a00-0000-7000-8000-0000000000ff" })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses anyone but a community manager", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const draft = await draftCampaign(h, manager);
    const actors = await refusedActors(h);

    for (const actor of Object.values(actors)) {
      await expect(h.as(actor).listCampaigns()).rejects.toBeInstanceOf(
        DomainError
      );
      await expect(
        h.as(actor).getCampaign({ id: draft.id })
      ).rejects.toBeInstanceOf(DomainError);
      await expect(
        h.as(actor).updateCampaign({ ...draft, subject: "Taken over" })
      ).rejects.toBeInstanceOf(DomainError);
    }
  });
});
