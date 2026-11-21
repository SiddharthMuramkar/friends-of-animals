import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHarness, type Harness } from "@/test/harness";
import { recordHeartbeat } from "@/worker/heartbeat";

import { GET } from "./route";

let h: Harness;
vi.mock("@/server/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/env", () => ({ env: () => ({ APP_ENV: "staging" }) }));
// `connection()` throws outside a Next.js request.
vi.mock("next/server", () => ({ connection: async () => {} }));

beforeEach(async () => {
  // The harness also fakes Date, which the route's clock reads.
  h = await createHarness();
});

const beat = () =>
  recordHeartbeat(
    h.db,
    { worker: "worker-staging", environment: "staging", version: "4f2a9c1" },
    h.clock.now()
  );

describe("GET /api/health/worker", () => {
  it("answers 200 while the worker beat within 120 s", async () => {
    await beat();
    h.clock.advance({ seconds: 120 });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      worker: { name: "worker-staging", ageSeconds: 120 },
    });
  });

  it("answers 503 stale 121 s after the last beat", async () => {
    await beat();
    h.clock.advance({ seconds: 121 });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "stale",
      worker: { name: "worker-staging", ageSeconds: 121 },
    });
  });

  it("answers 503 missing before the worker ever beat", async () => {
    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "missing" });
  });

  it("answers 503 without the error's details when the query fails", async () => {
    const secret = "password authentication failed for user staging_app";
    vi.spyOn(h.db, "select").mockImplementation(() => {
      throw new Error(secret);
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

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
