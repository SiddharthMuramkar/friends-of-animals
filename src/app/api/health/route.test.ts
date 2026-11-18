import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/test/db";

import { GET } from "./route";

let testDb: TestDb;
vi.mock("@/server/db", () => ({
  get db() {
    return testDb;
  },
}));

// `connection()` throws outside a Next.js request.
vi.mock("next/server", () => ({ connection: async () => {} }));

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("reports a reachable database", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      status: "ok",
      db: { ok: true, ms: expect.any(Number) },
    });
    expect(body.db.ms).toBeGreaterThanOrEqual(0);
  });

  it("answers 503 without the error's details when the query fails", async () => {
    const secret = "password authentication failed for user foa_app";
    vi.spyOn(testDb, "execute").mockRejectedValue(new Error(secret));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "error", db: { ok: false } });
    expect(text).not.toContain("password");
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Health check"),
      expect.objectContaining({ message: secret })
    );
  });
});
