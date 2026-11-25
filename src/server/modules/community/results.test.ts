import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_ACCOUNTS } from "../../seed/accounts";
import { SEED_GUARDIANS } from "../../seed/guardians";
import { SEED_RESULTS } from "../../seed/results";
import { staffActor } from "../volunteers/testing";

describe("the results engagement feed", () => {
  it("uses actual published results, keeps a minor's rungs separate, and rebuilds idempotently", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.drain();
    const adult = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
    const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const teen = h.as(await h.signIn(SEED_GUARDIANS.teen));
    const childId = SEED_GUARDIANS.children.teen.profileId;
    const competitionId = SEED_RESULTS.competitionId;
    const resultKinds = (
      rows: { kind: string; competitionId: string | null }[]
    ) =>
      rows
        .filter((r) => r.competitionId === competitionId)
        .map((r) => r.kind)
        .sort();
    expect(resultKinds((await adult.getTimeline()).milestones)).toEqual([
      "foa_finalist",
      "participant",
    ]);
    const child = await guardian.getTimeline({ childId });
    expect(resultKinds(child.milestones)).toEqual([
      "foa_finalist",
      "participant",
    ]);
    expect(await teen.getTimeline()).toEqual(child);
    expect(resultKinds((await guardian.getTimeline()).milestones)).toEqual([]);
    expect(
      child.entries
        .filter((r) => r.competitionId === competitionId)
        .every((r) => r.competitionName === "Art for kindness")
    ).toBe(true);
    const manager = h.as(await staffActor(h, "community_manager"));
    await expect(
      manager.rebuildMilestones({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      guardian.rebuildMilestones({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
    const admin = h.as(await staffActor(h, "super_admin"));
    expect(await admin.rebuildMilestones({ competitionId })).toMatchObject({
      ok: true,
    });
    expect(await admin.rebuildMilestones({ competitionId })).toMatchObject({
      ok: true,
    });
    expect(await guardian.getTimeline({ childId })).toEqual(child);
  });
});
