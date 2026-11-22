import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  type OrgFacts,
  unconfirmedOrgFacts,
} from "@/server/modules/cms/domain/org-facts";
import { createTestDb } from "@/test/db";

import { healthResponse } from "./_lib/health-response";

// GET waits for a real request (`connection()`), then answers with
// `healthResponse` for the app's database. These tests hand it theirs.

/** The organisation facts the route reads, as a test sets them. */
let facts: OrgFacts;
const orgFacts = async () => facts;

beforeEach(() => {
  facts = unconfirmedOrgFacts();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

      const response = await healthResponse({
        db: await openDatabase(),
        orgFacts,
      });

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
      facts = confirmed;

      const body = await (
        await healthResponse({ db: await openDatabase(), orgFacts })
      ).json();

      expect(body.facts).toBe("complete");
    });

    it("leaves facts out off production, where placeholders are expected", async () => {
      vi.stubEnv("APP_ENV", "preview");

      const body = await (
        await healthResponse({ db: await openDatabase(), orgFacts })
      ).json();

      expect(body).not.toHaveProperty("facts");
    });
  });
});
