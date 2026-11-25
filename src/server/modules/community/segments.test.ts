import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { communityManager, person, EVERYONE } from "../campaigns/testing";

describe("campaign milestone criteria", () => {
  it("selects members who reached the milestone only with current messages consent", async () => {
    const h = await createHarness();
    const manager = h.as(await communityManager(h));
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
    const segment = { ...EVERYONE, milestones: ["community_member"] };
    expect(await manager.previewSegment({ segment })).toMatchObject({
      ok: true,
      counts: { members: 1, recipients: 1 },
    });
    await h.as(opted.actor).withdrawConsent({ purpose: "messages" });
    expect(await manager.previewSegment({ segment })).toMatchObject({
      ok: true,
      counts: { members: 0, recipients: 0 },
    });
  });
});
