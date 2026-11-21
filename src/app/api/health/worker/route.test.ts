import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";
import { createHarness, type Harness } from "@/test/harness";
import { recordHeartbeat } from "@/worker/heartbeat";

import { workerHealthResponse } from "./_lib/worker-health-response";

// GET waits for a real request (`connection()`), then answers with
// `workerHealthResponse` for the app's database, clock and APP_ENV. These
// tests hand it a harness's.

afterEach(() => {
  vi.restoreAllMocks();
});

const beat = (h: Harness) =>
  recordHeartbeat(
    h.db,
    { worker: "worker-prod", environment: "production", version: "4f2a9c1" },
    h.clock.now()
  );

describe("GET /api/health/worker", () => {
  it("answers 200 while the worker beat within 120 s", async () => {
    const h = await createHarness();
    await beat(h);
    h.clock.advance({ seconds: 120 });

    const response = await workerHealthResponse(h.deps, "production");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      worker: { name: "worker-prod", ageSeconds: 120 },
    });
  });

  it("answers 503 stale 121 s after the last beat", async () => {
    const h = await createHarness();
    await beat(h);
    h.clock.advance({ seconds: 121 });

    const response = await workerHealthResponse(h.deps, "production");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "stale",
      worker: { name: "worker-prod", ageSeconds: 121 },
    });
  });

  it("answers 503 missing before the worker ever beat", async () => {
    const h = await createHarness();

    const response = await workerHealthResponse(h.deps, "production");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "missing" });
  });

  it("answers 503 without the error's details when the query fails", async () => {
    const h = await createHarness();
    const secret = "password authentication failed for user foa_app";
    vi.spyOn(h.db, "select").mockImplementation(() => {
      throw new Error(secret);
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await workerHealthResponse(h.deps, "production");

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

  it("answers 503 once the database is closed, and logs why", async () => {
    const db = await createTestDb();
    await db.$client.close();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await workerHealthResponse(
      { db, clock: new FakeClock() },
      "production"
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "error" });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Worker health check"),
      expect.any(Error)
    );
    const error: Error = logged.mock.calls[0]?.[1];
    expect(error.message).not.toBe("");
    expect(text).not.toContain(error.message);
  });
});
