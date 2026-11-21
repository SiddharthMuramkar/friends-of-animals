import { describe, expect, it } from "vitest";

import { planInvitations, type InvitationCandidate } from "./invitation-plan";

const ALL = { participants: true, guardians: true, coordinators: true };

const adult = (
  userId: string | null,
  consented: boolean
): InvitationCandidate => ({
  kind: "participant",
  minor: false,
  userId,
  consented,
  guardians: [],
});

const minor = (
  guardians: { userId: string; verified: boolean; consented: boolean }[],
  userId: string | null = null
): InvitationCandidate => ({
  kind: "participant",
  minor: true,
  userId,
  consented: true,
  guardians,
});

const coordinator = (
  userId: string,
  consented: boolean
): InvitationCandidate => ({ kind: "coordinator", userId, consented });

const g = (userId: string, consented = true, verified = true) => ({
  userId,
  verified,
  consented,
});

describe("planInvitations", () => {
  it("invites consented adults, guardians of minors and coordinators, once each", () => {
    const plan = planInvitations(
      [
        adult("A", true),
        adult("B", false),
        minor([g("G1")]),
        minor([g("G2")]),
        minor([g("G2")]),
        minor([g("G3", false)]),
        minor([]),
        // a teen with their own login: their guardian is asked, not them
        minor([g("G1")], "T"),
        coordinator("K", true),
      ],
      ALL
    );

    expect(plan).toEqual({
      invitations: [
        { userId: "A", role: "participant" },
        { userId: "G1", role: "guardian" },
        { userId: "G2", role: "guardian" },
        { userId: "K", role: "coordinator" },
      ],
      skipped: { noConsent: 2, noGuardian: 1, noAccount: 0 },
    });
  });

  it("skips an adult participant with no account to send to", () => {
    expect(planInvitations([adult(null, true)], ALL)).toEqual({
      invitations: [],
      skipped: { noConsent: 0, noGuardian: 0, noAccount: 1 },
    });
  });

  it("counts a minor whose guardians are all unverified as having no guardian", () => {
    expect(planInvitations([minor([g("G1", true, false)])], ALL)).toEqual({
      invitations: [],
      skipped: { noConsent: 0, noGuardian: 1, noAccount: 0 },
    });
  });

  it("invites only the audiences the survey names", () => {
    const people = [adult("A", true), minor([g("G1")]), coordinator("K", true)];
    const only = (audience: keyof typeof ALL) =>
      planInvitations(people, {
        participants: false,
        guardians: false,
        coordinators: false,
        [audience]: true,
      }).invitations.map((invitation) => invitation.userId);

    expect(only("participants")).toEqual(["A"]);
    expect(only("guardians")).toEqual(["G1"]);
    expect(only("coordinators")).toEqual(["K"]);
  });

  it("gives a person with several links one invitation, participant before guardian before coordinator", () => {
    const plan = planInvitations(
      [
        coordinator("P", true),
        minor([g("P")]),
        adult("P", true),
        coordinator("Q", true),
        minor([g("Q")]),
      ],
      ALL
    );
    expect(plan.invitations).toEqual([
      { userId: "P", role: "participant" },
      { userId: "Q", role: "guardian" },
    ]);
  });

  it("counts a person skipped through several links once", () => {
    expect(
      planInvitations([coordinator("R", false), minor([g("R", false)])], ALL)
        .skipped
    ).toEqual({ noConsent: 1, noGuardian: 0, noAccount: 0 });
  });

  it("returns invitations sorted by user id, whatever the input order", () => {
    const plan = planInvitations(
      [adult("c", true), adult("a", true), adult("b", true)],
      ALL
    );
    expect(plan.invitations.map((invitation) => invitation.userId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
