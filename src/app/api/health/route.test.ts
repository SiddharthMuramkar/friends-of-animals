import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestDb } from "@/test/db";

import { healthResponse } from "./_lib/health-response";

// GET waits for a real request (`connection()`), then answers with
// `healthResponse` for the app's database. These tests hand it theirs.

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh database with the real migrations, closed when the test ends. */
async function openDatabase() {
  const db = await createTestDb();
  onTestFinished(() => db.$client.close());
  return db;
}

describe("GET /api/health", () => {
  it("reports a reachable database", async () => {
    const db = await openDatabase();

    const response = await healthResponse({ db });

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
    const db = await openDatabase();
    const secret = "password authentication failed for user foa_app";
    vi.spyOn(db, "execute").mockRejectedValue(new Error(secret));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await healthResponse({ db });

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

  it("answers 503 once the database is closed, and logs why", async () => {
    const db = await createTestDb();
    await db.$client.close();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await healthResponse({ db });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "error", db: { ok: false } });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Health check"),
      expect.any(Error)
    );
    const error: Error = logged.mock.calls[0]?.[1];
    expect(error.message).not.toBe("");
    expect(text).not.toContain(error.message);
  });
});
