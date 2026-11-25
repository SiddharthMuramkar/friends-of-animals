import { beforeAll, afterAll, it, expect } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { istDateOf } from "../ledger/domain/period";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});

it("serializes competing snapshots and duplicate corrections under real PostgreSQL", async () => {
  const account = await world.seed.superAdmin({ email: world.uniqueEmail() });
  await world.seed.authenticator(account);
  const api = world.as(await world.signedIn(account, { secondFactor: true }));
  const date = istDateOf(world.clock.now());
  const metrics = {
    channel: "x",
    recordedFor: date,
    followers: 30,
    posts: 2,
    reach: 100,
    impressions: 150,
    engagements: 20,
  } as const;
  const first = await Promise.all([
    api.recordSocialSnapshot(metrics),
    api.recordSocialSnapshot(metrics),
  ]);
  expect(first).toEqual(
    expect.arrayContaining([
      { ok: true, outcome: "recorded" },
      { ok: true, outcome: "unchanged" },
    ])
  );
  const corrected = { ...metrics, followers: 31 };
  const next = await Promise.all([
    api.recordSocialSnapshot(corrected),
    api.recordSocialSnapshot(corrected),
  ]);
  expect(next).toEqual(
    expect.arrayContaining([
      { ok: true, outcome: "corrected" },
      { ok: true, outcome: "unchanged" },
    ])
  );
  const result = await api.getSocialReport({ from: date, to: date });
  if (!result.ok) throw Error(result.error);
  expect(result.report.snapshots.filter((s) => s.channel === "x")).toEqual([
    { ...corrected, followerChange: null },
  ]);
  const recorded = await api.searchAuditLog({
    action: "social_snapshot.recorded",
  });
  const correction = await api.searchAuditLog({
    action: "social_snapshot.corrected",
  });
  expect(recorded).toMatchObject({
    ok: true,
    entries: [
      {
        after: {
          fields: ["followers", "posts", "reach", "impressions", "engagements"],
        },
      },
    ],
  });
  expect(correction).toMatchObject({
    ok: true,
    entries: [{ after: { fields: ["followers"] } }],
  });
});
