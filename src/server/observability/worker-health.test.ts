import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";
import { recordHeartbeat } from "@/worker/heartbeat";

import { readWorkerHealth, workerFreshness } from "./worker-health";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("workerFreshness", () => {
  it.each([
    {
      case: "a beat 5 s ago",
      rows: [{ worker: "worker-prod", lastSeenAt: ago(5) }],
      expected: {
        status: "ok",
        worker: { name: "worker-prod", ageSeconds: 5 },
      },
    },
    {
      case: "a beat exactly 120 s ago",
      rows: [{ worker: "worker-prod", lastSeenAt: ago(120) }],
      expected: {
        status: "ok",
        worker: { name: "worker-prod", ageSeconds: 120 },
      },
    },
    {
      case: "a beat 120.5 s ago",
      rows: [{ worker: "worker-prod", lastSeenAt: ago(120.5) }],
      expected: {
        status: "stale",
        worker: { name: "worker-prod", ageSeconds: 120 },
      },
    },
    {
      case: "a beat 121 s ago",
      rows: [{ worker: "worker-prod", lastSeenAt: ago(121) }],
      expected: {
        status: "stale",
        worker: { name: "worker-prod", ageSeconds: 121 },
      },
    },
    {
      case: "the freshest of two beats",
      rows: [
        { worker: "worker-old", lastSeenAt: ago(3600) },
        { worker: "worker-prod", lastSeenAt: ago(30) },
      ],
      expected: {
        status: "ok",
        worker: { name: "worker-prod", ageSeconds: 30 },
      },
    },
    {
      // The worker's clock runs a little ahead of the app's.
      case: "a beat 2 s in the future",
      rows: [{ worker: "worker-prod", lastSeenAt: ago(-2) }],
      expected: {
        status: "ok",
        worker: { name: "worker-prod", ageSeconds: 0 },
      },
    },
    { case: "no beat at all", rows: [], expected: { status: "missing" } },
  ])("$case → $expected.status", ({ rows, expected }) => {
    expect(workerFreshness(rows, NOW, { maxAgeSeconds: 120 })).toEqual(
      expected
    );
  });
});

describe("readWorkerHealth", () => {
  const prod = {
    worker: "worker-prod",
    environment: "production",
    version: "4f2a9c1",
  } as const;

  it("reports the worker that beat 30 s ago as ok", async () => {
    const h = await createHarness();
    await recordHeartbeat(h.db, prod, h.clock.now());
    h.clock.advance({ seconds: 30 });

    await expect(readWorkerHealth(h.deps, "production")).resolves.toEqual({
      status: "ok",
      worker: { name: "worker-prod", ageSeconds: 30 },
    });
  });

  it("reports it stale 121 s after its last beat", async () => {
    const h = await createHarness();
    await recordHeartbeat(h.db, prod, h.clock.now());
    h.clock.advance({ seconds: 121 });

    await expect(readWorkerHealth(h.deps, "production")).resolves.toEqual({
      status: "stale",
      worker: { name: "worker-prod", ageSeconds: 121 },
    });
  });

  it("follows the worker's latest beat", async () => {
    const h = await createHarness();
    await recordHeartbeat(h.db, prod, h.clock.now());
    h.clock.advance({ seconds: 200 });
    await recordHeartbeat(h.db, prod, h.clock.now());
    h.clock.advance({ seconds: 5 });

    await expect(readWorkerHealth(h.deps, "production")).resolves.toEqual({
      status: "ok",
      worker: { name: "worker-prod", ageSeconds: 5 },
    });
  });

  it("reports a missing worker, ignoring another environment's beat", async () => {
    const h = await createHarness();
    await recordHeartbeat(
      h.db,
      { worker: "worker-local", environment: "local", version: "dev" },
      h.clock.now()
    );

    await expect(readWorkerHealth(h.deps, "production")).resolves.toEqual({
      status: "missing",
    });
  });
});
