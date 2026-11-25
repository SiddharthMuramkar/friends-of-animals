import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";
import { subjectScope } from "../privacy/requests/subject-data/scope";

describe("community data rights and retention", () => {
  it("exports only the named person, clears a departed profile after 365 days, keeps their earned history", async () => {
    const h = await createHarness();
    const family = await h.seed.guardian({
      children: [{ fullName: "Child sample", age: 8 }],
    });
    const childId = family.childIds[0]!;
    const guardian = h.as(await h.signIn(family.account));
    expect(
      await guardian.joinCommunity({ displayName: "Parent sample" })
    ).toMatchObject({ ok: true });
    expect(
      await guardian.joinCommunity({
        childId,
        displayName: "Child sample",
        about: "Private child's text",
      })
    ).toMatchObject({ ok: true });
    const getExport = async (
      subjectKind: "user" | "participant_profile",
      subjectId: string
    ) =>
      (
        await collectSubjectData(h.deps, {
          scope: await subjectScope(h.db, { subjectKind, subjectId }),
          subject: { kind: subjectKind, id: subjectId },
          reference: "COMMUNITY-EXPORT",
          generatedAt: h.clock.now(),
        })
      ).document.sections;
    const own = await getExport("user", family.account.id);
    expect(own.community_member).toMatchObject([
      { display_name: "Parent sample" },
    ]);
    expect(JSON.stringify(own.community_member)).not.toContain(
      "Private child's text"
    );
    const child = await getExport("participant_profile", childId);
    expect(child.community_member).toMatchObject([
      { display_name: "Child sample", about: "Private child's text" },
    ]);
    expect(child.engagement_milestone).toHaveLength(1);
    expect(child.timeline_entry).toHaveLength(1);
    expect(await guardian.leaveCommunity({ childId })).toMatchObject({
      ok: true,
    });
    await h.settings.set("retention.enforce", true);
    const worker = h.as({ kind: "system", process: "worker" });
    h.clock.advance({ days: 364 });
    await worker.runRetentionSweep();
    expect(
      (await getExport("participant_profile", childId)).community_member
    ).toMatchObject([{ display_name: "Child sample" }]);
    h.clock.advance({ days: 1 });
    await worker.runRetentionSweep();
    const refreshed = h.as(await h.signIn(family.account));
    expect((await refreshed.getMyCommunity({ childId })).member).toMatchObject({
      status: "left",
      displayName: null,
      about: null,
    });
    expect((await refreshed.getTimeline({ childId })).milestones).toHaveLength(
      1
    );
    expect((await refreshed.getMyCommunity()).member).toMatchObject({
      status: "active",
      displayName: "Parent sample",
    });
  });
});
