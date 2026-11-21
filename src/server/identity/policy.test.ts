import { describe, expect, it } from "vitest";

import type { Actor } from "../actor";
import { DomainError } from "../errors";
import { authorize, can, type IdentityAction } from "./policy";

const meta = { ip: "203.0.113.10", userAgent: "test" };
const visitor: Actor = { kind: "visitor", meta };
const user: Actor = { kind: "user", userId: "u", sessionId: "s", meta };
const system: Actor = { kind: "system", process: "seed" };

describe("can", () => {
  it("lets only a visitor sign up or sign in", () => {
    for (const action of ["requestEmailCode", "verifyEmailCode"] as const) {
      expect(can(visitor, action)).toBe(true);
      expect(can(user, action)).toBe(false);
      expect(can(system, action)).toBe(false);
    }
  });

  it("lets only a signed-in user see and end their own sessions", () => {
    for (const action of [
      "getAccount",
      "listSessions",
      "signOutSession",
      "signOutEverywhere",
    ] as const) {
      expect(can(user, action)).toBe(true);
      expect(can(visitor, action)).toBe(false);
      expect(can(system, action)).toBe(false);
    }
  });

  it("denies an action it has no rule for", () => {
    const unknown = "deleteEveryone" as IdentityAction;

    expect(can(user, unknown)).toBe(false);
    expect(can(visitor, unknown)).toBe(false);
    expect(can(system, unknown)).toBe(false);
  });
});

describe("authorize", () => {
  it("throws forbidden when can() says no, and nothing when it says yes", () => {
    expect(() => authorize(visitor, "requestEmailCode")).not.toThrow();
    expect(() => authorize(visitor, "getAccount")).toThrow(DomainError);
    expect(() => authorize(visitor, "getAccount")).toThrow(
      expect.objectContaining({ code: "forbidden" })
    );
  });
});
