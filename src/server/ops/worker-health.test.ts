import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, type Harness } from "@/test/harness";
import { recordHeartbeat } from "@/worker/heartbeat";

import {
  readWorkerHealth,
  workerFreshness,
  workerHealthResponse,
} from "./worker-health";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("workerFreshness", () => {
  it.each([
    {
      case: "a beat 5 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(5) }],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 5 },
      },
    },
    {
      case: "a beat exactly 120 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(120) }],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 120 },
      },
    },
    {
      case: "a beat 120.5 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(120.5) }],
      expected: {
        status: "stale",
        worker: { name: "worker-staging", ageSeconds: 120 },
      },
    },
    {
      case: "a beat 121 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(121) }],
      expected: {
        status: "stale",
        worker: { name: "worker-staging", ageSeconds: 121 },
      },
    },
    {
      case: "the freshest of two beats",
      rows: [
        { worker: "worker-old", lastSeenAt: ago(3600) },
        { worker: "worker-staging", lastSeenAt: ago(30) },
      ],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 30 },
      },
    },
    {
      // The worker's clock runs a little ahead of the app's.
      case: "a beat 2 s in the future",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(-2) }],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 0 },
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
  const staging = {
    worker: "worker-staging",
    environment: "staging",
    version: "4f2a9c1",
  } as const;

  it("reports the worker that beat 30 s ago as ok", async () => {
    const h = await createHarness();
    await recordHeartbeat(h.db, staging, h.clock.now());
    h.clock.advance({ seconds: 30 });

    await expect(readWorkerHealth(h.deps, "staging")).resolves.toEqual({
      status: "ok",
      worker: { name: "worker-staging", ageSeconds: 30 },
    });
  });

  it("reports it stale 121 s after its last beat", async () => {
    const h = await createHarness();
    await recordHeartbeat(h.db, staging, h.clock.now());
    h.clock.advance({ seconds: 121 });

    await expect(readWorkerHealth(h.deps, "staging")).resolves.toEqual({
      status: "stale",
      worker: { name: "worker-staging", ageSeconds: 121 },
    });
  });

  it("follows the worker's latest beat", async () => {
    const h = await createHarness();
    await recordHeartbeat(h.db, staging, h.clock.now());
    h.clock.advance({ seconds: 200 });
    await recordHeartbeat(h.db, staging, h.clock.now());
    h.clock.advance({ seconds: 5 });

    await expect(readWorkerHealth(h.deps, "staging")).resolves.toEqual({
      status: "ok",
      worker: { name: "worker-staging", ageSeconds: 5 },
    });
  });

  it("reports a missing worker, ignoring another environment's beat", async () => {
    const h = await createHarness();
    await recordHeartbeat(
      h.db,
      { worker: "worker-local", environment: "local", version: "dev" },
      h.clock.now()
    );

    await expect(readWorkerHealth(h.deps, "staging")).resolves.toEqual({
      status: "missing",
    });
  });
});

describe("workerHealthResponse (GET /api/health/worker)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const beat = (h: Harness) =>
    recordHeartbeat(
      h.db,
      { worker: "worker-staging", environment: "staging", version: "4f2a9c1" },
      h.clock.now()
    );

  it("answers 200 while the worker beat within 120 s", async () => {
    const h = await createHarness();
    await beat(h);
    h.clock.advance({ seconds: 120 });

    const response = await workerHealthResponse(h.deps, "staging");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      worker: { name: "worker-staging", ageSeconds: 120 },
    });
  });

  it("answers 503 stale 121 s after the last beat", async () => {
    const h = await createHarness();
    await beat(h);
    h.clock.advance({ seconds: 121 });

    const response = await workerHealthResponse(h.deps, "staging");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "stale",
      worker: { name: "worker-staging", ageSeconds: 121 },
    });
  });

  it("answers 503 missing before the worker ever beat", async () => {
    const h = await createHarness();

    const response = await workerHealthResponse(h.deps, "staging");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "missing" });
  });

  it("answers 503 without the error's details when the query fails", async () => {
    const h = await createHarness();
    const secret = "password authentication failed for user staging_app";
    vi.spyOn(h.db, "select").mockImplementation(() => {
      throw new Error(secret);
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await workerHealthResponse(h.deps, "staging");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "error" });
    expect(text).not.toContain("password");
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Worker health check"),
      expect.objectContaining({ message: secret })
    );
  });
});
