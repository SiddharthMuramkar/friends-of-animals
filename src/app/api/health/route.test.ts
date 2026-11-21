import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unconfirmedOrgFacts } from "@/server/cms/domain/org-facts";
import { createTestDb, type TestDb } from "@/test/db";

import { GET } from "./route";

const orgFacts = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/cms/org-facts", () => ({
  getOrgFacts: async () => orgFacts.current,
}));

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
  orgFacts.current = unconfirmedOrgFacts();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

  describe("organisation facts", () => {
    const confirmed = {
      legalName: "Friends of Animals Foundation",
      email: "hello@friendsofanimals.example",
      phone: "+91 80 1234 5678",
      address: "12 Example Road, Bengaluru 560001",
      registration: {
        type: "Section 8 company",
        number: "U00000KA2026NPL000000",
        pan: "AAAAA0000A",
      },
      grievanceOfficer: {
        name: "A. Example",
        email: "grievance@friendsofanimals.example",
      },
      socials: ["https://www.instagram.com/example"],
    };

    it("says production's facts are incomplete, without naming them", async () => {
      vi.stubEnv("APP_ENV", "production");

      const response = await GET();

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({
        status: "ok",
        facts: "incomplete",
      });
      expect(text).not.toMatch(/legalName|email|pan/);
    });

    it("says production's facts are complete once FOA has entered them", async () => {
      vi.stubEnv("APP_ENV", "production");
      orgFacts.current = confirmed;

      const body = await (await GET()).json();

      expect(body.facts).toBe("complete");
    });

    it("leaves facts out off production, where placeholders are expected", async () => {
      vi.stubEnv("APP_ENV", "preview");

      const body = await (await GET()).json();

      expect(body).not.toHaveProperty("facts");
    });
  });
});
