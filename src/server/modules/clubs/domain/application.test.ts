import { describe, expect, it } from "vitest";

import {
  CLUB_NAME_MAX_LENGTH,
  clubNameSchema,
  decideClubApplication,
} from "./application";

describe("applying to start a club", () => {
  it("is open to a student or teacher of a verified institution", () => {
    for (const role of ["student", "teacher"] as const) {
      expect(
        decideClubApplication({
          institutionVerified: true,
          role,
          hasPendingApplication: false,
        })
      ).toEqual({ ok: true, applicantKind: role });
    }
  });

  it("is refused for an institution that isn't verified", () => {
    expect(
      decideClubApplication({
        institutionVerified: false,
        role: "teacher",
        hasPendingApplication: false,
      })
    ).toEqual({ ok: false, error: "institution_not_verified" });
  });

  it("is refused to someone who isn't at the institution", () => {
    expect(
      decideClubApplication({
        institutionVerified: true,
        role: null,
        hasPendingApplication: false,
      })
    ).toEqual({ ok: false, error: "not_at_institution" });
  });

  it("is refused while their earlier application there is undecided", () => {
    expect(
      decideClubApplication({
        institutionVerified: true,
        role: "student",
        hasPendingApplication: true,
      })
    ).toEqual({ ok: false, error: "application_pending" });
  });

  it("names the unverified institution before anything about the person", () => {
    expect(
      decideClubApplication({
        institutionVerified: false,
        role: null,
        hasPendingApplication: true,
      })
    ).toEqual({ ok: false, error: "institution_not_verified" });
  });
});

describe("a club's name", () => {
  it("is trimmed, with runs of spaces made single", () => {
    expect(clubNameSchema.parse("  Green   Paws\tClub \n")).toBe(
      "Green Paws Club"
    );
  });

  it("has at least 3 characters", () => {
    expect(clubNameSchema.safeParse("  Ab ").success).toBe(false);
    expect(clubNameSchema.parse("Abc")).toBe("Abc");
  });

  it("has at most 80 characters", () => {
    expect(CLUB_NAME_MAX_LENGTH).toBe(80);
    expect(clubNameSchema.parse("a".repeat(80))).toHaveLength(80);
    expect(clubNameSchema.safeParse("a".repeat(81)).success).toBe(false);
  });

  it("isn't anything but text", () => {
    expect(clubNameSchema.safeParse(42).success).toBe(false);
    expect(clubNameSchema.safeParse(undefined).success).toBe(false);
  });
});
