import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});

it("serializes concurrent joins and rejoins for the same person", async () => {
  const account = await world.seed.member({ email: world.uniqueEmail() });
  const api = world.as(await world.signedIn(account));
  const join = async () =>
    world.sql.begin(async (blocker) => {
      await blocker`select 1 from "user" where id=${account.id} for update`;
      const first = api.joinCommunity({ displayName: "Community one" });
      first.catch(() => {});
      await world.waitForLockWaiters(1);
      const second = api.joinCommunity({ displayName: "Community two" });
      second.catch(() => {});
      await world.waitForLockWaiters(2);
      return { first, second };
    });
  const first = await join();
  expect(await Promise.all([first.first, first.second])).toEqual(
    expect.arrayContaining([
      { ok: false, error: "already_member" },
      { ok: true, memberId: expect.any(String) },
    ])
  );
  const membership = (await api.getMyCommunity()).member;
  expect(membership?.status).toBe("active");
  expect((await api.getTimeline()).milestones).toHaveLength(1);
  expect(await api.leaveCommunity()).toMatchObject({ ok: true });
  const second = await join();
  expect(await Promise.all([second.first, second.second])).toEqual(
    expect.arrayContaining([
      { ok: false, error: "already_member" },
      { ok: true, memberId: membership!.id },
    ])
  );
  expect((await api.getTimeline()).entries).toHaveLength(1);
});
