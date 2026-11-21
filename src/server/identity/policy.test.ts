import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { authorize, can } from "../access/can";
import type { Action } from "../access/policies";
import type { Actor } from "../actor";
import { DomainError } from "../errors";

const meta = { ip: "203.0.113.10", userAgent: "test" };
const visitor: Actor = { kind: "visitor", meta };
const user: Actor = {
  kind: "user",
  userId: "01938a00-0000-7000-8000-000000000101",
  sessionId: "s",
  meta,
};
const system: Actor = { kind: "system", process: "seed" };

let db: TestDb;
const clock = new FakeClock();

// One database per test: can() reads a signed-in user's grants from it.
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.$client.close();
});

/** Whether `actor` may take `action`, by the platform policy. */
async function allowed(actor: Actor, action: Action) {
  return (await can({ db, clock, actor }, action)).allowed;
}

describe("can, for the identity use cases", () => {
  it("lets only a visitor sign up or sign in", async () => {
    for (const action of ["requestEmailCode", "verifyEmailCode"] as const) {
      expect(await allowed(visitor, action)).toBe(true);
      expect(await allowed(user, action)).toBe(false);
      expect(await allowed(system, action)).toBe(false);
    }
  });

  it("lets only a signed-in user see and end their own sessions", async () => {
    for (const action of [
      "getAccount",
      "listSessions",
      "signOutSession",
      "signOutEverywhere",
    ] as const) {
      expect(await allowed(user, action)).toBe(true);
      expect(await allowed(visitor, action)).toBe(false);
      expect(await allowed(system, action)).toBe(false);
    }
  });

  it("denies an action it has no rule for", async () => {
    const unknown = "deleteEveryone" as Action;

    expect(await allowed(user, unknown)).toBe(false);
    expect(await allowed(visitor, unknown)).toBe(false);
    expect(await allowed(system, unknown)).toBe(false);
  });
});

describe("authorize, for the identity use cases", () => {
  it("throws forbidden when can() says no, and nothing when it says yes", async () => {
    await expect(
      authorize({ db, clock, actor: visitor }, "requestEmailCode")
    ).resolves.toEqual({ role: null });
    const refused = authorize({ db, clock, actor: visitor }, "getAccount");
    await expect(refused).rejects.toBeInstanceOf(DomainError);
    await expect(refused).rejects.toMatchObject({ code: "forbidden" });
  });
});
