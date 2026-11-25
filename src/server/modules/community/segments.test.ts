import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  communityManager,
  person,
  EVERYONE,
  draftCampaign,
  sendDraft,
  SAMPLE_CONTENT,
} from "../campaigns/testing";

describe("campaign milestone criteria", () => {
  it("selects members who reached the milestone only with current messages consent", async () => {
    const h = await createHarness();
    const managerActor = await communityManager(h);
    const manager = h.as(managerActor);
    const opted = await person(h, {
      name: "Opted member",
      email: "opted@example.test",
    });
    const unconsented = await person(h, {
      name: "Private member",
      email: "private@example.test",
      consent: false,
    });
    await person(h, { name: "Nonmember", email: "nonmember@example.test" });
    expect(
      await h.as(opted.actor).joinCommunity({ displayName: "Opted" })
    ).toMatchObject({ ok: true });
    expect(
      await h.as(unconsented.actor).joinCommunity({ displayName: "Private" })
    ).toMatchObject({ ok: true });
    const segment = { ...EVERYONE, milestones: ["community_member" as const] };
    expect(await manager.previewSegment({ segment })).toMatchObject({
      ok: true,
      counts: { members: 1, recipients: 1 },
    });
    const draft = await draftCampaign(h, managerActor, {
      milestones: ["community_member"],
    });
    await sendDraft(h, managerActor, draft);
    await h.drain();
    expect(
      h.email.sent
        .filter((message) => message.subject === SAMPLE_CONTENT.subject)
        .map((message) => message.to)
    ).toEqual([opted.email]);
    await h.as(opted.actor).withdrawConsent({ purpose: "messages" });
    expect(await manager.previewSegment({ segment })).toMatchObject({
      ok: true,
      counts: { members: 0, recipients: 0 },
    });
  });
});
