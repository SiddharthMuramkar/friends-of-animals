import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { signedInWith } from "../judging/testing";
import { parseCsv } from "../registration/domain/csv";

const scope = { type: "global" } as const;
const period = { from: "2027-01-01", to: "2027-01-15" };
const metrics = {
  channel: "instagram",
  recordedFor: "2026-12-31",
  followers: 100,
  posts: 3,
  reach: 400,
  impressions: 500,
  engagements: 60,
} as const;
it("records one observation per channel and day, shows the dated trend with the preceding baseline, and exports solely aggregate data", async () => {
  const h = await createHarness();
  const editor = h.as(
    await signedInWith(h, { role: "content_manager", scope })
  );
  const leader = h.as(await signedInWith(h, { role: "staff_admin", scope }));
  const admin = h.as(await signedInWith(h, { role: "super_admin", scope }));
  const member = h.as(await h.signIn(await h.seed.member()));
  expect(await editor.recordSocialSnapshot(metrics)).toMatchObject({
    ok: true,
    outcome: "recorded",
  });
  const second = {
    ...metrics,
    recordedFor: "2027-01-03",
    followers: 150,
    posts: 2,
    reach: null,
    impressions: 700,
    engagements: 70,
  };
  expect(await editor.recordSocialSnapshot(second)).toMatchObject({
    ok: true,
    outcome: "recorded",
  });
  expect(await editor.recordSocialSnapshot(second)).toMatchObject({
    ok: true,
    outcome: "unchanged",
  });
  const third = {
    ...metrics,
    recordedFor: "2027-01-15",
    followers: 141,
    posts: 0,
    reach: 0,
    impressions: null,
    engagements: null,
  };
  expect(await editor.recordSocialSnapshot(third)).toMatchObject({
    ok: true,
    outcome: "recorded",
  });
  expect(
    await editor.recordSocialSnapshot({ ...third, followers: 145 })
  ).toMatchObject({ ok: true, outcome: "corrected" });
  expect(
    await editor.recordSocialSnapshot({
      ...third,
      channel: "youtube",
      followers: 30,
    })
  ).toMatchObject({ ok: true });
  for (const invalid of [
    { ...third, followers: -1 },
    { ...third, posts: 1.25 },
    { ...third, recordedFor: "2027-01-16" },
    { ...third, followers: 2_147_483_648 },
    { ...third, recordedFor: "2027-02-30" },
  ]) {
    expect(await editor.recordSocialSnapshot(invalid)).toMatchObject({
      ok: false,
      error: "invalid_input",
    });
  }
  const trend = [
    { ...second, followerChange: 50 },
    { ...third, followers: 145, followerChange: -5 },
    { ...third, channel: "youtube", followers: 30, followerChange: null },
  ];
  expect(await editor.getSocialReport(period)).toEqual({
    ok: true,
    report: { period, snapshots: trend },
  });
  expect(await leader.getObjectiveReport(period)).toMatchObject({
    ok: true,
    report: { social: trend },
  });
  const exported = await editor.exportSocialReportCsv(period);
  if (!exported.ok) throw Error(exported.error);
  expect(parseCsv(exported.csv)).toMatchObject({
    ok: true,
    records: expect.arrayContaining([
      ["instagram", "2027-01-03", "150", "50", "2", "", "700", "70"],
      ["instagram", "2027-01-15", "145", "-5", "0", "0", "", ""],
      ["youtube", "2027-01-15", "30", "", "0", "0", "", ""],
    ]),
  });
  const objectiveCsv = await leader.exportObjectiveReportCsv(period);
  if (!objectiveCsv.ok) throw Error(objectiveCsv.error);
  expect(objectiveCsv.csv).toContain("instagram,2027-01-15,145,-5,0,0,,");
  expect(exported.csv).not.toContain("example.test");
  const audit = await admin.searchAuditLog({
    action: "social_snapshot.corrected",
  });
  expect(audit).toMatchObject({
    ok: true,
    entries: [
      {
        entity: { type: "social_snapshot", id: expect.any(String) },
        before: null,
        after: { fields: ["followers"] },
      },
    ],
  });
  // Reporting rights and content-recording rights are deliberately separate.
  await expect(leader.recordSocialSnapshot(metrics)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(member.recordSocialSnapshot(metrics)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(member.getSocialReport(period)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(member.exportSocialReportCsv(period)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(editor.getObjectiveReport(period)).rejects.toMatchObject({
    code: "forbidden",
  });
});
