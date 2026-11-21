import { describe, expect, it } from "vitest";

import { minorAudience } from "./minor-audience";

const guardian = (userId: string, overrides = {}) => ({
  userId,
  verified: true,
  revoked: false,
  ...overrides,
});

describe("minorAudience", () => {
  it("sends messages about an adult to the adult", () => {
    expect(
      minorAudience({ minor: false, loginUserId: "adult", guardians: [] })
    ).toEqual({
      kind: "deliver",
      recipients: [{ userId: "adult", channels: "all" }],
    });
  });

  it("sends messages about a child under 13 to the guardian only", () => {
    expect(
      minorAudience({
        minor: true,
        loginUserId: null,
        guardians: [guardian("mum")],
      })
    ).toEqual({
      kind: "deliver",
      recipients: [{ userId: "mum", channels: "all" }],
    });
  });

  it("sends messages about a teen to the guardian, with an in-app copy for the teen", () => {
    expect(
      minorAudience({
        minor: true,
        loginUserId: "teen",
        guardians: [guardian("mum")],
      })
    ).toEqual({
      kind: "deliver",
      recipients: [
        { userId: "mum", channels: "all" },
        { userId: "teen", channels: "in_app_only" },
      ],
    });
  });

  it("leaves out revoked and unverified guardians", () => {
    expect(
      minorAudience({
        minor: true,
        loginUserId: null,
        guardians: [
          guardian("old", { revoked: true }),
          guardian("pending", { verified: false }),
          guardian("dad"),
        ],
      })
    ).toEqual({
      kind: "deliver",
      recipients: [{ userId: "dad", channels: "all" }],
    });
  });

  it("sends nothing about a minor who has no active guardian, not even the teen's copy", () => {
    expect(
      minorAudience({
        minor: true,
        loginUserId: "teen",
        guardians: [guardian("old", { revoked: true })],
      })
    ).toEqual({ kind: "suppress", reason: "no_guardian" });
  });

  it("sends nothing about an adult without a login", () => {
    expect(
      minorAudience({ minor: false, loginUserId: null, guardians: [] })
    ).toEqual({ kind: "suppress", reason: "no_login" });
  });

  it("names each guardian once, in link order", () => {
    expect(
      minorAudience({
        minor: true,
        loginUserId: null,
        guardians: [guardian("mum"), guardian("dad"), guardian("mum")],
      })
    ).toEqual({
      kind: "deliver",
      recipients: [
        { userId: "mum", channels: "all" },
        { userId: "dad", channels: "all" },
      ],
    });
  });

  it("never sends an adult's guardians anything about them", () => {
    expect(
      minorAudience({
        minor: false,
        loginUserId: "adult",
        guardians: [guardian("mum")],
      })
    ).toEqual({
      kind: "deliver",
      recipients: [{ userId: "adult", channels: "all" }],
    });
  });
});
