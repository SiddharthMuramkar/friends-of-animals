import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";

import {
  conductError,
  conductOutcome,
  isConductOutcome,
} from "./conduct-outcome";

describe("the conduct page's outcome", () => {
  it("names what certifyConduct answered", () => {
    expect(conductOutcome({ ok: true, certifiedAt: new Date(0) })).toBe(
      "certified"
    );
    expect(conductOutcome({ ok: false, error: "already_certified" })).toBe(
      "already_certified"
    );
    expect(
      conductOutcome({
        ok: false,
        error: "invalid_input",
        fields: ["reference"],
      })
    ).toBe("not_found");
  });

  it("says forbidden for a refused actor and failed for anything else", () => {
    expect(conductError(new DomainError("forbidden", "no"))).toBe("forbidden");
    expect(conductError(new Error("database down"))).toBe("failed");
  });

  it("reads only known outcomes back from the address", () => {
    expect(isConductOutcome("certified")).toBe(true);
    expect(isConductOutcome("anything")).toBe(false);
    expect(isConductOutcome(undefined)).toBe(false);
  });
});
