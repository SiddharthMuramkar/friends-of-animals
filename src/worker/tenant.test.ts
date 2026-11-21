import { describe, expect, it } from "vitest";

import { workerHeartbeat } from "@/server/db/schema";
import { emitUserSignedUp } from "@/server/outbox/testing";
import { createHarness, type Harness } from "@/test/harness";

import { createTenant, type WorkerIdentity } from "./tenant";

const PREVIEW_WORKER: WorkerIdentity = {
  worker: "worker-preview",
  environment: "preview",
  version: "0123abc",
};


function tenantFor(h: Harness, identity = PREVIEW_WORKER) {
  return createTenant({
    database: "foa_pr_143_0a1b2c3d",
    deps: { db: h.db, clock: h.clock, email: h.email },
    identity,
    end: async () => {},
  });
}

describe("a tenant's tick", () => {
  it("sends what is due and records the worker's heartbeat", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ name: "Asha Rao" });
    await emitUserSignedUp(h, member.id);

    const report = await tenantFor(h).tick();

    expect(report).toMatchObject({ dispatched: 1, retried: 0, failed: 0 });
    expect(h.email.lastTo(member.email)?.subject).toBe(
      "Welcome to Friends of Animals"
    );
    expect(await h.db.select().from(workerHeartbeat)).toEqual([
      {
        worker: "worker-preview",
        environment: "preview",
        lastSeenAt: h.clock.now(),
        version: "0123abc",
      },
    ]);
  });

  it("moves the same heartbeat row on at every tick, idle or not", async () => {
    const h = await createHarness();
    const tenant = tenantFor(h);
    await tenant.tick();

    h.clock.advance({ seconds: 5 });
    await tenant.tick();

    expect(await h.db.select().from(workerHeartbeat)).toEqual([
      expect.objectContaining({ lastSeenAt: h.clock.now() }),
    ]);
  });

  it("keeps each worker's heartbeat apart in a shared database", async () => {
    const h = await createHarness();
    await tenantFor(h).tick();
    await tenantFor(h, {
      worker: "worker-local",
      environment: "local",
      version: "dev",
    }).tick();

    const rows = await h.db.select().from(workerHeartbeat);
    expect(rows.map((row) => row.worker).sort()).toEqual([
      "worker-local",
      "worker-preview",
    ]);
  });
});

describe("closing a tenant", () => {
  it("ends its database connections", async () => {
    const h = await createHarness();
    let ended = 0;
    const tenant = createTenant({
      database: "foa_pr_143_0a1b2c3d",
      deps: { db: h.db, clock: h.clock, email: h.email },
      identity: PREVIEW_WORKER,
      end: async () => {
        ended += 1;
      },
    });

    await tenant.close();

    expect(ended).toBe(1);
  });
});
